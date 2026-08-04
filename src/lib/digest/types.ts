export type DigestPerformer = {
  name: string;
  /**
   * Inferred from the event title, never from array order — Ticketmaster
   * publishes no billing order. False here means "we could not tell", not
   * "support act", which is why the template labels these "same bill".
   */
  isHeadliner: boolean;
  tmUrl: string | null;
  imageUrl: string | null;
  youtubeUrl: string;
  youtubeThumbnailUrl: string | null;
  spotifyUrl: string;
};

export type DigestEvent = {
  tmEventId: string;
  name: string;
  url: string | null;
  /** "Fri, Aug 7" — already local to the venue. */
  dateLabel: string;
  timeLabel: string | null;
  localDate: string;
  venueName: string | null;
  cityLabel: string;
  imageUrl: string | null;
  genreName: string | null;
  performers: DigestPerformer[];
  /** Ranking score; also used to decide what makes the email cut. */
  score: number;
  /** Names of the user's followed artists that appear on this bill. */
  matchedArtists: string[];
};

/**
 * A show whose tickets go on sale during the digest window.
 *
 * Intentionally thinner than DigestEvent: no artwork, no performer rows, no
 * enrichment. This section is a deadline list, and its job is to be scannable and
 * to cost almost nothing against the email's byte budget.
 */
export type DigestOnsale = {
  tmEventId: string;
  name: string;
  url: string | null;
  /** When the show is, which for these is usually months out. */
  dateLabel: string;
  venueName: string | null;
  cityLabel: string;
  /** The onsale instant, ISO. Rendered in the subscriber's own timezone. */
  onsaleStart: string;
  /** Followed artists on this bill, same signal as DigestEvent. */
  matchedArtists: string[];
  score: number;
};

export type Digest = {
  userId: string;
  email: string;
  timezone: string;
  /** "Aug 7 – Aug 13" */
  windowLabel: string;
  /** Ranked. The email renders a prefix of this; the web view renders it all. */
  events: DigestEvent[];
  /** How many are in `events`, before the email truncates. */
  totalEventCount: number;
  /**
   * Ticket drops in this window, ranked by the same genre/artist signal.
   *
   * Separate from `events` because it answers a different question. The original
   * premise — the next seven days of shows — is already too late for anything in
   * demand: those tickets sold weeks earlier. This is the part a reader can still
   * act on.
   */
  onsale: DigestOnsale[];
  cities: string[];
  /**
   * Set when `events` is not the result of the reader's own filters.
   *
   * `"no_preferences"` means they have no positive genre weight and no followed
   * artists, so this is simply everything listed in their cities. The email has to
   * say so: presenting an unfiltered list as a filtered one would teach the reader
   * that the filtering does not work, and there is no popularity signal in the
   * Ticketmaster data that would justify calling it a "top shows" list either.
   */
  fallbackReason: "no_preferences" | null;
  /**
   * How `events` is actually ordered.
   *
   * `"relevance"` when the scores differ, `"date"` when they are all equal — which is
   * the normal case for somebody who follows only genres, because every explicit genre
   * weighs 1.0 and the sort then falls entirely through to the date tiebreak.
   *
   * Surfaced rather than hidden because the alternative is telling a reader their email
   * is ranked by relevance when it is a chronological list. There is no honest
   * tiebreaker available: Ticketmaster publishes no popularity or listing-count signal
   * (the same gap that makes genre-ranking.ts a hand-curated file).
   */
  ordering: "relevance" | "date";
  previewUrl: string;
  unsubscribeUrl: string;
  unsubscribeMailto: string | null;
  siteUrl: string;
};

/**
 * How many events the email itself carries.
 *
 * Gmail clips a message body over 102 KB and hides everything below it —
 * including the unsubscribe link — so the email is capped and the remainder
 * lives behind the "view all" link. See assertEmailSize in ./render.
 */
export const MAX_EMAIL_EVENTS = 10;

/**
 * How many performers each card lists.
 *
 * This, not the event count, is what actually drives email size: a festival bill
 * with a dozen acts renders a dozen sub-tables. The remainder is summarised as a
 * count rather than dropped silently.
 */
export const MAX_EMAIL_PERFORMERS = 3;

/** How many events get YouTube enrichment. Only what the email will show. */
export const MAX_ENRICHED_PERFORMERS = 24;

/**
 * How many onsale rows the email carries.
 *
 * Small deliberately. These rows are cheap, but they sit above the shows, and a
 * long list of things that are not on sale *yet* would push the week's actual
 * listings out of the first screen.
 */
export const MAX_ONSALE_EVENTS = 4;
