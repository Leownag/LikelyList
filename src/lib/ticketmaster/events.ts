import type { TmClient } from "./client";
import { DEEP_PAGING_LIMIT } from "./client";
import { MUSIC_SEGMENT_ID, type TmEvent, type TmEventsResponse } from "./types";
import { pickImage, primaryClassification, resolveLineup } from "./lineup";
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

const PAGE_SIZE = 100;

export type EventSearchParams = {
  /** Exactly the string Ticketmaster's `city` parameter expects. */
  city?: string;
  /**
   * A postal code, as an alternative to `city`. Ticketmaster accepts this
   * directly, which is what makes the explore page's ZIP search possible without
   * a geocoding step.
   */
  postalCode?: string;
  countryCode?: string;
  /** Inclusive UTC start of the window. */
  startDateTime: Date;
  /** Exclusive UTC end of the window. */
  endDateTime: Date;
  /** Caps pages fetched. The explore page wants one page, not ten. */
  maxPages?: number;
};

/** Ticketmaster rejects date-times carrying milliseconds. */
function toTmDateTime(date: Date): string {
  return `${date.toISOString().split(".")[0]}Z`;
}

export async function searchMusicEvents(
  client: TmClient,
  params: EventSearchParams,
): Promise<TmEvent[]> {
  if (!params.city && !params.postalCode) {
    throw new Error("searchMusicEvents needs either a city or a postal code.");
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
      countryCode: params.countryCode ?? "US",
      // The documented Music segment ID. Genre IDs are not hardcoded anywhere
      // (see scripts/seed-genres.ts) but this one the docs do publish.
      segmentId: MUSIC_SEGMENT_ID,
      startDateTime: toTmDateTime(params.startDateTime),
      endDateTime: toTmDateTime(params.endDateTime),
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
  cityId: number,
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
    city_id: cityId,
    tm_event_id: event.id,
    name: event.name,
    url: event.url ?? null,
    local_date: event.dates?.start?.localDate ?? null,
    local_time: event.dates?.start?.localTime ?? null,
    venue_name: venue?.name ?? null,
    venue_city: venue?.city?.name ?? null,
    venue_state: venue?.state?.stateCode ?? venue?.state?.name ?? null,
    image_url: pickImage(event.images, { maxWidth: 320, ratio: "16_9" }),
    tm_genre_id: classification.genreId,
    tm_subgenre_id: classification.subGenreId,
    attractions,
    fetched_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

/** Events whose status makes them not worth emailing about. */
export function isSendableEvent(event: TmEvent): boolean {
  const status = event.dates?.status?.code;
  if (status === "cancelled" || status === "postponed") return false;
  // Without a date there is nothing to say about when to show up.
  return Boolean(event.dates?.start?.localDate);
}
