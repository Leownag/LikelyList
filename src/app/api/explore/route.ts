import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { visitorHash } from "@/lib/visitor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTicketmasterClient } from "@/lib/ticketmaster/client";
import {
  PAGE_SIZE as TICKETMASTER_PAGE_SIZE,
  isSendableEvent,
  searchMusicEvents,
} from "@/lib/ticketmaster/events";
import {
  eventTimezone,
  pickImage,
  primaryClassification,
  resolveLineup,
} from "@/lib/ticketmaster/lineup";
import { spotifySearchUrl, youtubeSearchUrl } from "@/lib/enrich/links";
import { encodeGeohash } from "@/lib/geohash";
import { geocodePostalCode } from "@/lib/geocode";
import { formatEventDate, formatEventTime, localDateString } from "@/lib/time";
import type { TmEvent } from "@/lib/ticketmaster/types";
import type { Genre } from "@/lib/db";
import type { ExploreEvent } from "@/lib/explore/types";
import { placeLabel as labelFor } from "@/lib/places";

/**
 * Public event search for /explore. No sign-in, no email.
 *
 * This is the only unauthenticated endpoint that spends Ticketmaster quota, which
 * is 5000 requests a day for the whole project and is also what the weekly send
 * depends on. So it is capped twice: a global daily budget that leaves plenty of
 * headroom for the digest, and a per-visitor hourly cap.
 *
 * The per-visitor key is an HMAC of the caller's IP, never the address itself —
 * a rate limiter needs to recognise a repeat caller, not to keep a log of who
 * visited. Truncated, and it changes whenever the secret is rotated.
 */

/** Leaves the large majority of the daily Ticketmaster quota for the digest. */
const DAILY_EXPLORE_BUDGET = 800;
const HOURLY_PER_VISITOR = 30;

/**
 * How far around the chosen point to look, in miles.
 *
 * Fifty, because that is what the question actually means. Somebody asking what is
 * on near Boston will drive to Worcester for the right band, and `city=Boston`
 * misses it — measured at 21 events for the city filter against 85 for this radius
 * on the same week. A hundred miles returns more still, but starts reaching into
 * Providence and Hartford, which are somebody else's city rather than a suburb of
 * this one.
 */
const SEARCH_RADIUS_MILES = 50;

/** Enough precision to place a metro centre; the radius does the rest. */
const GEOHASH_PRECISION = 6;

const BodySchema = z
  .object({
    /**
     * Where to search from, as a point. Sent instead of a city name because that is
     * what Ticketmaster needs, and because it frees the picker from the 43 curated
     * metros — any of the 32,329 Census places carries its own coordinates.
     */
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    /** Display only, echoed back so the UI can say where it searched. */
    placeLabel: z.string().max(120).optional(),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit US ZIP code.")
      .nullable()
      .default(null),
    genreIds: z.array(z.number().int()).max(20).default([]),
    /**
     * How far to look, in miles. Bounded rather than free-form: a 500-mile
     * "nearby" is not a search anybody wants, and an unbounded value invites
     * pulling a whole region through a quota-metered endpoint.
     */
    radiusMiles: z
      .number()
      .int()
      .min(5)
      .max(100)
      .default(SEARCH_RADIUS_MILES),
  })
  .refine(
    (value) =>
      Boolean(value.postalCode) ||
      (value.latitude !== undefined && value.longitude !== undefined),
    { message: "Pick a city or enter a ZIP code." },
  );

/**
 * The seven days the search covers, stated in the venue-local terms the rows use.
 *
 * Anchored on the earliest row rather than on UTC: Ticketmaster labels every
 * event with the venue's own local date, so a range derived from UTC disagreed
 * with the first row on screen — the header said the 20th above a row dated the
 * 19th.
 *
 * Two earlier attempts were both wrong, in opposite directions, and for the same
 * reason: the search is bounded by UTC instants while every row is labelled with
 * a venue's local date, and those do not line up. Computing the range in UTC put
 * the 19th under a header that said the 20th. Anchoring on the first row and
 * adding six days then put the 27th under a header that said the 26th, because a
 * seven-day span of instants touches eight local days.
 *
 * So the window is simply what came back. Stated that way it cannot disagree
 * with the list beneath it, which is the only property that matters here. That
 * the rows may stop short of a full week is a different fact, and `truncated`
 * is what carries it.
 */
function searchedWindow(events: TmEvent[], fallbackStart: Date): string {
  const dates = events
    .map((event) => event.dates?.start?.localDate)
    .filter((date): date is string => Boolean(date))
    .sort();

  if (dates.length === 0) {
    const only = localDateString("UTC", fallbackStart);
    return `${only} … ${only}`;
  }
  return `${dates[0]} … ${dates[dates.length - 1]}`;
}

export async function POST(request: NextRequest) {
  const env = readEnv();

  if (!env.ticketmasterApiKey || !env.supabaseServiceRoleKey) {
    return NextResponse.json(
      { error: "Search is not configured on this server yet." },
      { status: 503 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Check your search.")
        : "Check your search.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = createAdminClient(env);
  const day = new Date().toISOString().slice(0, 10);

  const { data: usedToday } = await supabase.rpc("bump_global_usage", {
    p_kind: "explore_query",
    p_day: day,
    p_amount: 1,
  });
  if (typeof usedToday === "number" && usedToday > DAILY_EXPLORE_BUDGET) {
    return NextResponse.json(
      {
        error:
          "Search has hit today's limit — the remaining Ticketmaster quota is reserved for the weekly emails. Try again tomorrow.",
      },
      { status: 429 },
    );
  }

  const visitorKey = await visitorHash(request, env.unsubscribeHmacSecret);
  const hourKey = `${day}T${new Date().getUTCHours()}`;
  const { data: usedThisHour } = await supabase.rpc("bump_global_usage", {
    p_kind: `explore_ip:${visitorKey}:${hourKey}`,
    p_day: day,
    p_amount: 1,
  });
  if (typeof usedThisHour === "number" && usedThisHour > HOURLY_PER_VISITOR) {
    return NextResponse.json(
      { error: "That's a lot of searches. Give it a few minutes." },
      { status: 429 },
    );
  }

  const { data: genreRows } = await supabase
    .from("genres")
    .select("id, tm_genre_id, name");

  // Both paths end up as a point plus a radius, because that is the only shape
  // Ticketmaster honours (see EventSearchParams.geoPoint for the numbers). A ZIP is
  // geocoded; a place chosen from the picker already arrived as coordinates.
  let centre: { latitude: number; longitude: number } | null = null;
  let placeLabel: string | null = null;

  if (body.postalCode) {
    const located = await geocodePostalCode(supabase, body.postalCode);
    if (!located) {
      return NextResponse.json(
        {
          error:
            "We couldn't place that ZIP code. Check it, or pick a city instead.",
        },
        { status: 400 },
      );
    }
    centre = located;
    placeLabel = labelFor(located.placeName, located.stateCode);
  } else if (body.latitude !== undefined && body.longitude !== undefined) {
    centre = { latitude: body.latitude, longitude: body.longitude };
    placeLabel = body.placeLabel ?? null;
  }

  const allGenres = (genreRows ?? []) as Pick<
    Genre,
    "id" | "tm_genre_id" | "name"
  >[];
  const nameByTmId = new Map(allGenres.map((g) => [g.tm_genre_id, g.name]));
  const wantedTmGenreIds = new Set(
    allGenres
      .filter((genre) => body.genreIds.includes(genre.id))
      .map((genre) => genre.tm_genre_id),
  );

  // Unreachable given the schema's refine, but narrowing it here keeps the request
  // builder honest rather than relying on a validator two hundred lines away.
  if (!centre) {
    return NextResponse.json(
      { error: "Pick a city or enter a ZIP code." },
      { status: 400 },
    );
  }

  // Deliberately from this instant rather than from UTC midnight.
  //
  // The header said "2026-10-20 … 2026-10-26" while the first row was a show on
  // the 19th, because the window was computed in UTC and every row is labelled
  // with the venue's own local date. At 20:00 Eastern, UTC midnight "today" is
  // already two hours into tomorrow, so the search reached back into a night
  // that had started — tickets for which Ticketmaster answers with TICKET SALES
  // TERMINATED.
  //
  // Starting at `now` cannot return a show that has begun, whatever zone the
  // venue is in, and needs no timezone lookup for a point we only have
  // coordinates for.
  const now = new Date();
  const searchEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const client = createTicketmasterClient(env.ticketmasterApiKey);
    const found = await searchMusicEvents(client, {
      // Always coordinates. The schema requires either a ZIP or a point, and both
      // resolve to one, so there is no name-matching path left to fall back to —
      // which is the point: `city` matched a venue's city field and missed the next
      // town over.
      geoPoint: encodeGeohash(
        centre.latitude,
        centre.longitude,
        GEOHASH_PRECISION,
      ),
      radius: body.radiusMiles,
      unit: "miles",
      countryCode: "US",
      startDateTime: now,
      endDateTime: searchEnd,
      // One page. Somebody browsing does not need ten — but a full page means
      // the week is cut short, which the response says so the UI can too.
      maxPages: 1,
    });

    const events: ExploreEvent[] = found
      .filter((event) => isSendableEvent(event))
      .filter((event) => {
        if (wantedTmGenreIds.size === 0) return true;
        const genreId = primaryClassification(event).genreId;
        return genreId ? wantedTmGenreIds.has(genreId) : false;
      })
      .map((event) => {
        const venue = event._embedded?.venues?.[0];
        const genreId = primaryClassification(event).genreId;
        return {
          id: event.id,
          name: event.name,
          url: event.url ?? null,
          dateLabel: event.dates?.start?.localDate
            ? formatEventDate(event.dates.start.localDate)
            : "Date TBA",
          timeLabel: formatEventTime(event.dates?.start?.localTime ?? null),
          localDate: event.dates?.start?.localDate ?? "",
          localTime: event.dates?.start?.localTime ?? null,
          venueName: venue?.name ?? null,
          cityLabel: venue?.city?.name ?? placeLabel ?? "",
          imageUrl: pickImage(event.images, { maxWidth: 320, ratio: "16_9" }),
          genreName: genreId ? (nameByTmId.get(genreId) ?? null) : null,
          timezone: eventTimezone(event),
          performers: resolveLineup(event).map(({ attraction, isHeadliner }) => ({
            name: attraction.name,
            isHeadliner,
            tmUrl: attraction.url ?? null,
            youtubeUrl: youtubeSearchUrl(attraction.name),
            spotifyUrl: spotifySearchUrl(attraction.name),
          })),
        };
      })
      .sort((a, b) => a.localDate.localeCompare(b.localDate));

    return NextResponse.json({
      events,
      window: searchedWindow(found, now),
      // One page is all we ask for, so a full page means there was more.
      truncated: found.length >= TICKETMASTER_PAGE_SIZE,
      // So the UI can say "12 of 43 matched your genres" honestly.
      totalBeforeGenreFilter: found.filter((event) => isSendableEvent(event)).length,
      // Echoed back so a ZIP search can show where it decided that was — the one
      // way somebody notices they typed 02143 instead of 02134.
      placeLabel,
      radiusMiles: centre ? body.radiusMiles : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Ticketmaster search failed: ${error.message}`
            : "Ticketmaster search failed.",
      },
      { status: 502 },
    );
  }
}
