/**
 * Hand-written row types for the schema in supabase/migrations/.
 *
 * Deliberately not generated with `supabase gen types`: that needs a reachable
 * project at build time, which would make `npm run build` fail on a fresh clone
 * with no credentials. Keep this file in step with the migrations by hand.
 */

export type PrefSource = "explicit" | "feed";
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
  city_id: number;
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

/** Shape the vision extractor is constrained to produce. See lib/vision. */
export type FeedExtraction = {
  artists: { name: string; role: "headliner" | "support" | null; confidence: number | null }[];
  venue: string | null;
  city: string | null;
  state: string | null;
  date: string | null;
  time: string | null;
  genres: string[];
  ticket_url: string | null;
  raw_text: string | null;
  overall_confidence: number | null;
  not_an_event_poster: boolean;
};

export type Feed = {
  id: string;
  user_id: string;
  status: FeedStatus;
  image_path: string | null;
  model: string | null;
  extracted: FeedExtraction | null;
  confidence: number | null;
  not_an_event: boolean;
  applied_at: string | null;
  error: string | null;
  created_at: string;
};

export type FeedArtist = {
  id: number;
  feed_id: string;
  name: string;
  normalized_name: string;
  role: string | null;
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
  city_id: number;
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
export const USAGE_YOUTUBE_SEARCH = "youtube_search";
