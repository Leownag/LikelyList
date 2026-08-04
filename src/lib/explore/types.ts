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
  venueName: string | null;
  cityLabel: string;
  imageUrl: string | null;
  genreName: string | null;
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
