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
};
