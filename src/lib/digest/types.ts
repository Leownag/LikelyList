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
  cities: string[];
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
