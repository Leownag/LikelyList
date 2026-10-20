/**
 * Shape returned by /api/explore.
 *
 * Its own module rather than being exported from the route file: importing a type
 * from a route handler drags that module into whatever bundle imports it, and the
 * explore UI is a client component. Keeping the contract here means both sides can
 * reference it without the client pulling in server-only code.
 */

export type ExplorePerformer = {
  name: string;
  /**
   * Inferred from the event title, never from array order — Ticketmaster publishes
   * no billing order. False means "could not tell", not "support act".
   */
  isHeadliner: boolean;
  tmUrl: string | null;
  youtubeUrl: string;
  spotifyUrl: string;
};

export type ExploreEvent = {
  id: string;
  name: string;
  url: string | null;
  dateLabel: string;
  timeLabel: string | null;
  localDate: string;
  /** Raw venue-local `HH:MM:SS`. timeLabel is for display; this is for arithmetic. */
  localTime: string | null;
  venueName: string | null;
  cityLabel: string;
  imageUrl: string | null;
  genreName: string | null;
  /**
   * The venue's IANA zone, straight from Ticketmaster.
   *
   * Needed only by "add to calendar", and needed absolutely: without it an 8pm Boston
   * show lands in a Los Angeles calendar at 8pm Pacific, three hours wrong.
   */
  timezone: string | null;
  performers: ExplorePerformer[];
};

export type ExploreResponse = {
  events: ExploreEvent[];
  /** "2026-08-07 … 2026-08-13" */
  window: string;
  /** Before the genre filter, so the UI can say "12 of 43" honestly. */
  totalBeforeGenreFilter: number;
  /**
   * Where the search was actually centred, e.g. "Allston, MA".
   *
   * Echoed back mainly for ZIP searches: it is the only way somebody notices they
   * typed 02143 when they meant 02134.
   */
  placeLabel: string | null;
  /** The radius used, so the UI can offer to widen or narrow it. */
  radiusMiles: number | null;
  /**
   * Ticketmaster filled the one page we ask for, so the later days of the
   * window are probably incomplete.
   *
   * Worth saying out loud: results are date-ordered, so a busy city runs out of
   * page before it runs out of week, and the list silently stops short of the
   * seven days the page promises.
   */
  truncated: boolean;
};

/** Offered by the advanced control. Fifty is the default. */
export const RADIUS_CHOICES = [10, 25, 50, 75, 100] as const;

/**
 * Somewhere to search from.
 *
 * Coordinates rather than a name, because that is what Ticketmaster needs — a point
 * and a radius. It follows that a place needs no `tm_city` and does not have to be
 * one of the curated metros, which is the whole reason every US town can be offered.
 *
 * Split from PlaceSuggestion so the currently-selected place can also be a curated
 * city, which has coordinates but no Census GEOID.
 */
export type PlacePoint = {
  name: string;
  stateCode: string | null;
  latitude: number;
  longitude: number;
};

/** A PlacePoint that came from /api/places/search, so it has a stable id. */
export type PlaceSuggestion = PlacePoint & {
  /** Census GEOID. Stable across yearly Gazetteer files. */
  geoid: string;
};
