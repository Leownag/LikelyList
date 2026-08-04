import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTicketmasterClient } from "@/lib/ticketmaster/client";
import { isSendableEvent, searchMusicEvents } from "@/lib/ticketmaster/events";
import { pickImage, primaryClassification, resolveLineup } from "@/lib/ticketmaster/lineup";
import { spotifySearchUrl, youtubeSearchUrl } from "@/lib/enrich/links";
import { digestWindow, formatEventDate, formatEventTime } from "@/lib/time";
import type { City, Genre } from "@/lib/db";
import type { ExploreEvent } from "@/lib/explore/types";

/**
 * Public event search for /explore. No sign-in, no email.
 *
 * This is the only unauthenticated endpoint that spends Ticketmaster quota, which
 * is 5000 requests a day for the whole project and is also what the Friday send
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

const BodySchema = z
  .object({
    citySlug: z.string().max(64).nullable().default(null),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit US ZIP code.")
      .nullable()
      .default(null),
    genreIds: z.array(z.number().int()).max(20).default([]),
  })
  .refine((value) => Boolean(value.citySlug || value.postalCode), {
    message: "Pick a city or enter a ZIP code.",
  });

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
          "Search has hit today's limit — the remaining Ticketmaster quota is reserved for the Friday emails. Try again tomorrow.",
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

  // Resolve the city and the genre filter from our own tables.
  const [cityResult, genresResult] = await Promise.all([
    body.citySlug
      ? supabase
          .from("cities")
          .select("id, name, tm_city, state_code, country_code")
          .eq("slug", body.citySlug)
          .maybeSingle<
            Pick<City, "id" | "name" | "tm_city" | "state_code" | "country_code">
          >()
      : Promise.resolve({ data: null }),
    supabase.from("genres").select("id, tm_genre_id, name"),
  ]);

  const city = cityResult.data;
  if (body.citySlug && !city) {
    return NextResponse.json({ error: "Unknown city." }, { status: 400 });
  }

  const allGenres = (genresResult.data ?? []) as Pick<
    Genre,
    "id" | "tm_genre_id" | "name"
  >[];
  const nameByTmId = new Map(allGenres.map((g) => [g.tm_genre_id, g.name]));
  const wantedTmGenreIds = new Set(
    allGenres
      .filter((genre) => body.genreIds.includes(genre.id))
      .map((genre) => genre.tm_genre_id),
  );

  const window = digestWindow(new Date(), "UTC");

  try {
    const client = createTicketmasterClient(env.ticketmasterApiKey);
    const found = await searchMusicEvents(client, {
      city: city?.tm_city,
      postalCode: body.postalCode ?? undefined,
      countryCode: city?.country_code ?? "US",
      startDateTime: window.start,
      endDateTime: window.end,
      // One page. Somebody browsing does not need ten.
      maxPages: 1,
    });

    const events: ExploreEvent[] = found
      .filter(isSendableEvent)
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
          venueName: venue?.name ?? null,
          cityLabel:
            venue?.city?.name ??
            [city?.name, city?.state_code].filter(Boolean).join(", "),
          imageUrl: pickImage(event.images, { maxWidth: 320, ratio: "16_9" }),
          genreName: genreId ? (nameByTmId.get(genreId) ?? null) : null,
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
      window: `${window.startDate} … ${window.endDate}`,
      // So the UI can say "12 of 43 matched your genres" honestly.
      totalBeforeGenreFilter: found.filter(isSendableEvent).length,
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

/**
 * A stable, non-reversible key for the caller.
 *
 * Cloudflare provides the client IP in `CF-Connecting-IP`. It is hashed with the
 * app secret and truncated, so what ends up in the counters table identifies a
 * repeat caller without recording who they are.
 */
async function visitorHash(request: NextRequest, secret: string): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (!secret) return ip === "unknown" ? "unknown" : "unkeyed";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );

  return [...new Uint8Array(signature)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
