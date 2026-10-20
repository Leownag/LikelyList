import type { TmClient } from "./client";
import { DEEP_PAGING_LIMIT } from "./client";
import { MUSIC_SEGMENT_ID, type TmEvent, type TmEventsResponse } from "./types";
import {
  eventTimezone,
  pickImage,
  primaryClassification,
  resolveLineup,
} from "./lineup";
import type { CachedAttraction, CachedEvent } from "@/lib/db";

/**
 * Event search.
 *
 * Queries are made per CITY, not per user. Two subscribers who both follow
 * Boston share one API call, and genre filtering happens in our own code
 * afterwards against each event's primary genre ID. Filtering server-side per
 * user would multiply requests by (users x genres) against a 5000/day quota for
 * no benefit.
 */

/**
 * Exported so a caller that asks for one page can tell a full page from a
 * complete answer. A full page means the window was cut short, not that the
 * window is empty after that date.
 */
export const PAGE_SIZE = 100;

export type EventSearchParams = {
  /** Exactly the string Ticketmaster's `city` parameter expects. */
  city?: string;
  /**
   * A postal code, as an alternative to `city`.
   *
   * Accepted, but a poor filter and no longer used by anything: Ticketmaster matches
   * the ZIP exactly, so it only ever finds venues inside that one code — two events
   * for Boston's 02134 against eighty-five for the same area by coordinates. Kept
   * because it is a legitimate parameter, but prefer `geoPoint`.
   */
  postalCode?: string;
  /**
   * A geohash of the centre of the search, paired with `radius`.
   *
   * This is the only location filter `radius` actually works with. Measured on one
   * Boston week, same dates throughout:
   *
   *   city=Boston                       21 events
   *   city=Boston + radius=50mi         21 events   (radius ignored)
   *   postalCode=02134 + radius=50mi     2 events   (radius ignored)
   *   geoPoint + radius=25mi            64 events
   *   geoPoint + radius=50mi            85 events
   *
   * `city` matches a venue's city field, so it misses everything one town over even
   * though it is twenty minutes away — which for someone deciding where to go is the
   * wrong shape of question entirely.
   */
  geoPoint?: string;
  radius?: number;
  /** Defaults to miles when a radius is given. */
  unit?: "miles" | "km";
  countryCode?: string;
  /** Inclusive UTC start of the window. */
  startDateTime: Date;
  /** Exclusive UTC end of the window. */
  endDateTime: Date;
  /**
   * Narrows to events whose public onsale starts on or after this DATE.
   *
   * A plain `YYYY-MM-DD`, and it has to be this parameter rather than the
   * better-named `onsaleStartDateTime` / `onsaleEndDateTime` pair. Those two are
   * documented and accepted — and measured to do nothing at all. Boston, one week:
   *
   *   onsaleStartDateTime + onsaleEndDateTime → 535 events, 1 on sale that week
   *   no onsale filter whatsoever            → 536 events, 1 on sale that week
   *   onsaleOnAfterStartDate                 →   3 events, 3 on sale that week
   *
   * The first two being the same result is the tell: Ticketmaster takes the
   * datetime pair, returns 200, and ignores it. Only the date form filters.
   *
   * There is no matching upper bound, so callers that want one apply it
   * themselves — `buildDigest` already bounds the section to the digest window.
   */
  onsaleOnAfterStartDate?: Date;
  /** Caps pages fetched. The explore page wants one page, not ten. */
  maxPages?: number;
};

/** Ticketmaster rejects date-times carrying milliseconds. */
function toTmDateTime(date: Date): string {
  return `${date.toISOString().split(".")[0]}Z`;
}

/** `YYYY-MM-DD`, which is the only form the onsale filter honours. */
function toTmDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function searchMusicEvents(
  client: TmClient,
  params: EventSearchParams,
): Promise<TmEvent[]> {
  if (!params.city && !params.postalCode && !params.geoPoint) {
    throw new Error(
      "searchMusicEvents needs a city, a postal code or a geoPoint.",
    );
  }

  const events: TmEvent[] = [];
  const maxPages = Math.min(
    params.maxPages ?? Number.POSITIVE_INFINITY,
    Math.floor(DEEP_PAGING_LIMIT / PAGE_SIZE),
  );

  for (let page = 0; page < maxPages; page++) {
    const response = await client.get<TmEventsResponse>("/events.json", {
      city: params.city,
      postalCode: params.postalCode,
      geoPoint: params.geoPoint,
      radius: params.radius,
      // Ticketmaster's own default is miles, but stating it means a future change
      // there cannot quietly reinterpret every radius in this codebase.
      unit: params.radius ? (params.unit ?? "miles") : undefined,
      countryCode: params.countryCode ?? "US",
      // The documented Music segment ID. Genre IDs are not hardcoded anywhere
      // (see scripts/seed-genres.ts) but this one the docs do publish.
      segmentId: MUSIC_SEGMENT_ID,
      startDateTime: toTmDateTime(params.startDateTime),
      endDateTime: toTmDateTime(params.endDateTime),
      onsaleOnAfterStartDate: params.onsaleOnAfterStartDate
        ? toTmDate(params.onsaleOnAfterStartDate)
        : undefined,
      sort: "date,asc",
      size: PAGE_SIZE,
      page,
      // Placeholder listings have no date or lineup worth emailing about.
      includeTBA: "no",
      includeTBD: "no",
      includeTest: "no",
    });

    const batch = response._embedded?.events ?? [];
    events.push(...batch);

    const totalPages = response.page?.totalPages ?? 0;
    if (batch.length < PAGE_SIZE || page + 1 >= totalPages) break;
  }

  return events;
}

/**
 * Flattens a Ticketmaster event into the row we cache and render from.
 *
 * Everything the email needs is denormalised here so rendering never has to
 * call the API again — which also means the cache can be purged aggressively
 * after the send, as Ticketmaster's terms require.
 */
export function toCachedEvent(
  event: TmEvent,
  geoCell: string,
  expiresAt: Date,
): CachedEvent {
  const venue = event._embedded?.venues?.[0];
  const classification = primaryClassification(event);

  const attractions: CachedAttraction[] = resolveLineup(event).map(
    ({ attraction, isHeadliner }) => ({
      tm_attraction_id: attraction.id ?? null,
      name: attraction.name,
      url: attraction.url ?? null,
      image_url: pickImage(attraction.images, { maxWidth: 320, ratio: "3_2" }),
      tm_genre_id: primaryClassification(attraction).genreId,
      is_headliner: isHeadliner,
    }),
  );

  return {
    geo_cell: geoCell,
    // Kept nullable and unset: nothing keys on a city any more, and writing one here
    // would imply the search was scoped to it.
    city_id: null,
    tm_event_id: event.id,
    name: event.name,
    url: event.url ?? null,
    local_date: event.dates?.start?.localDate ?? null,
    local_time: event.dates?.start?.localTime ?? null,
    timezone: eventTimezone(event),
    venue_name: venue?.name ?? null,
    venue_city: venue?.city?.name ?? null,
    venue_state: venue?.state?.stateCode ?? venue?.state?.name ?? null,
    image_url: pickImage(event.images, { maxWidth: 320, ratio: "16_9" }),
    tm_genre_id: classification.genreId,
    tm_subgenre_id: classification.subGenreId,
    attractions,
    onsale_start: onsaleStart(event),
    fetched_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

/**
 * The public onsale instant, or null.
 *
 * Null covers everything that means the same thing to the email — nothing to
 * announce:
 *
 *  - no sales block at all, or an onsale flagged TBD/TBA;
 *  - a value that is not a real date. Worth guarding because a bad string would
 *    otherwise reach Postgres as a timestamptz and fail the whole city's cache
 *    write, losing every event for that city rather than one field;
 *  - Ticketmaster's `1900-01-01` sentinel, which it uses for "on sale since
 *    forever". Measured at 8 of 100 events on a single Boston week, so this is the
 *    common case, not an edge one. It would never land inside a digest window and
 *    so would never render, but storing a fake 1900 timestamp makes the column lie
 *    about what it holds.
 */
function onsaleStart(event: TmEvent): string | null {
  const sale = event.sales?.public;
  if (!sale || sale.startTBD || sale.startTBA || !sale.startDateTime) return null;

  const parsed = new Date(sale.startDateTime);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCFullYear() < 2000) return null;

  return parsed.toISOString();
}

/** Events whose status makes them not worth emailing about. */
export function isSendableEvent(event: TmEvent, now = new Date()): boolean {
  const status = event.dates?.status?.code;
  if (status === "cancelled" || status === "postponed") return false;
  // Without a date there is nothing to say about when to show up.
  if (!event.dates?.start?.localDate) return false;

  // Sales that have already closed. The one action this product offers is a
  // link to buy, and Ticketmaster answers a closed sale with a page reading
  // "TICKET SALES TERMINATED" — a worse outcome for the reader than simply not
  // listing the show. `now` is injectable so this is testable without clocks.
  const salesEnd = event.sales?.public?.endDateTime;
  if (salesEnd) {
    const ends = new Date(salesEnd);
    // An unparseable value is not evidence of anything, so it is ignored
    // rather than treated as "ended".
    if (!Number.isNaN(ends.getTime()) && ends.getTime() < now.getTime()) {
      return false;
    }
  }

  return true;
}
