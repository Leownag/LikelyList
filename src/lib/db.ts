/**
 * Hand-written row types for the schema in supabase/migrations/.
 *
 * Deliberately not generated with `supabase gen types`: that needs a reachable
 * project at build time, which would make `npm run build` fail on a fresh clone
 * with no credentials. Keep this file in step with the migrations by hand.
 */

export type PrefSource = "explicit" | "feed" | "spotify";
export type FeedStatus = "pending" | "processing" | "done" | "failed";
export type RunStatus = "building" | "queued" | "done" | "failed";
export type JobStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export type City = {
  id: number;
  slug: string;
  name: string;
  tm_city: string;
  state_code: string | null;
  country_code: string;
  dma_id: number | null;
  latitude: number | null;
  longitude: number | null;
  sort_order: number;
};

export type Genre = {
  id: number;
  tm_genre_id: string;
  tm_segment_id: string;
  name: string;
  slug: string;
  sort_order: number;
};

export type Profile = {
  id: string;
  email: string;
  timezone: string;
  digest_send_hour: number;
  digest_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type Subscription = {
  id: number;
  user_id: string;
  /** Nullable since 0014: a subscription to a Census place has no curated city. */
  city_id: number | null;
  latitude: number;
  longitude: number;
  /** Display only — "Amherst" / "MA". Nothing builds a query from these. */
  place_name: string | null;
  state_code: string | null;
  /** The quarter-degree cell, which is what the planner batches on. */
  geo_cell: string;
  created_at: string;
};

export type GenrePref = {
  id: number;
  user_id: string;
  genre_id: number;
  weight: number;
  source: PrefSource;
};

export type ArtistPref = {
  id: number;
  user_id: string;
  name: string;
  normalized_name: string;
  tm_attraction_id: string | null;
  score: number;
  source: PrefSource;
  last_seen_at: string;
};

/**
 * Shape the vision extractor is constrained to produce. See lib/vision/schema.ts,
 * which is the single source of truth — this mirrors it for database reads.
 *
 * The usual input is a music app screenshot, not a concert flyer, so the flyer
 * fields (venue, city, date, time, ticket_url) are null in the common case.
 */
export type FeedSourceKind = "music_app" | "playlist" | "concert_flyer" | "other";

export type FeedExtraction = {
  not_music_related: boolean;
  source_kind: FeedSourceKind | null;
  artists: {
    name: string;
    prominence: "primary" | "mentioned" | null;
    confidence: number | null;
  }[];
  tracks: { title: string; artist: string | null }[];
  genres: string[];
  venue: string | null;
  city: string | null;
  state: string | null;
  date: string | null;
  time: string | null;
  ticket_url: string | null;
  raw_text: string | null;
  overall_confidence: number | null;
};

export type Feed = {
  id: string;
  user_id: string;
  status: FeedStatus;
  image_path: string | null;
  model: string | null;
  extracted: FeedExtraction | null;
  confidence: number | null;
  not_music_related: boolean;
  applied_at: string | null;
  error: string | null;
  created_at: string;
};

export type FeedArtist = {
  id: number;
  feed_id: string;
  name: string;
  normalized_name: string;
  prominence: string | null;
  tm_attraction_id: string | null;
  tm_genre_id: string | null;
};

export type ArtistRow = {
  tm_attraction_id: string;
  name: string;
  normalized_name: string;
  tm_url: string | null;
  image_url: string | null;
  tm_genre_id: string | null;
  external_links: Record<string, { id?: string; url?: string }[]> | null;
  youtube_channel_id: string | null;
  youtube_uploads_playlist_id: string | null;
  youtube_video_id: string | null;
  youtube_looked_up_at: string | null;
  refreshed_at: string;
};

/** One performer as stored inside events_cache.attractions. */
export type CachedAttraction = {
  tm_attraction_id: string | null;
  name: string;
  url: string | null;
  image_url: string | null;
  tm_genre_id: string | null;
  is_headliner: boolean;
};

export type CachedEvent = {
  /**
   * The quarter-degree grid cell this was fetched for, e.g. "42.25,-71".
   *
   * Replaced `city_id` as the key. Subscriptions store a point now, so there is no city
   * to key on — and the cell is the query centre as well as the key, which is what lets
   * subscribers in the same cell share one Ticketmaster call. See lib/geo-cell.ts.
   */
  geo_cell: string;
  city_id: number | null;
  tm_event_id: string;
  name: string;
  url: string | null;
  local_date: string | null;
  local_time: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  image_url: string | null;
  tm_genre_id: string | null;
  tm_subgenre_id: string | null;
  attractions: CachedAttraction[];
  /**
   * When public tickets go on sale, as an absolute instant (`timestamptz`).
   *
   * Null for the many events that are already on sale or never published one.
   * Unlike `local_date` this is not a venue wall clock, because "10am Friday" for
   * an onsale is a real moment everyone races at once.
   */
  onsale_start: string | null;
  fetched_at: string;
  expires_at: string;
};

export type DigestRun = {
  id: string;
  run_date: string;
  status: RunStatus;
  window_start: string;
  window_end: string;
  stats: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type DigestJob = {
  id: number;
  run_id: string;
  user_id: string;
  status: JobStatus;
  send_after: string;
  attempts: number;
  event_count: number | null;
  email_id: string | null;
  error: string | null;
  locked_until: string | null;
  sent_at: string | null;
};

/** Counter keys used with bump_usage / bump_global_usage. */
export const USAGE_FEED_UPLOAD = "feed_upload";
export const USAGE_ARTIST_SEARCH = "artist_search";
export const USAGE_YOUTUBE_SEARCH = "youtube_search";
