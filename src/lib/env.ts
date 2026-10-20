/**
 * Environment access.
 *
 * Two callers with different shapes read these values: Next route handlers and
 * server components (via `process.env`, which OpenNext populates from Wrangler
 * vars and secrets), and the Worker's `scheduled` handler (which is handed an
 * `env` object directly). Everything downstream takes an explicit `AppEnv` so
 * neither path has to care.
 */

export type AppEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  ticketmasterApiKey: string;
  openaiApiKey: string;
  openaiVisionModel: string;
  feedDailyUploadLimit: number;
  artistDailySearchLimit: number;
  spotifyClientId: string;
  spotifyClientSecret: string;
  youtubeApiKey: string;
  youtubeDailySearchLimit: number;
  resendApiKey: string;
  emailFrom: string;
  emailUnsubscribeMailto: string;
  siteUrl: string;
  cronSecret: string;
  unsubscribeHmacSecret: string;
};

type RawEnv = Record<string, string | undefined>;

function required(raw: RawEnv, key: string): string {
  const value = raw[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. See .env.example.`,
    );
  }
  return value;
}

function optional(raw: RawEnv, key: string, fallback = ""): string {
  return raw[key] ?? fallback;
}

function int(raw: RawEnv, key: string, fallback: number): number {
  const parsed = Number.parseInt(raw[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads an AppEnv from any record of strings.
 *
 * Only the Supabase values are hard-required, because they are needed to render
 * a signed-in page at all. The rest are validated at their point of use, so a
 * missing YouTube key degrades one feature rather than breaking the whole site.
 */
export function readEnv(raw: RawEnv = process.env as RawEnv): AppEnv {
  return {
    supabaseUrl: required(raw, "NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: required(raw, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: optional(raw, "SUPABASE_SERVICE_ROLE_KEY"),
    ticketmasterApiKey: optional(raw, "TICKETMASTER_API_KEY"),
    openaiApiKey: optional(raw, "OPENAI_API_KEY"),
    openaiVisionModel: optional(raw, "OPENAI_VISION_MODEL", "gpt-4o-mini"),
    feedDailyUploadLimit: int(raw, "FEED_DAILY_UPLOAD_LIMIT", 20),
    // Typing into the artist box spends Ticketmaster's 5000/day event quota, one
    // call per keystroke burst. Per-user rather than project-wide, so one person
    // exploring cannot starve everyone else's weekly send.
    artistDailySearchLimit: int(raw, "ARTIST_DAILY_SEARCH_LIMIT", 60),
    // Absent is a supported state: the connect button hides and nothing else changes.
    spotifyClientId: optional(raw, "SPOTIFY_CLIENT_ID"),
    spotifyClientSecret: optional(raw, "SPOTIFY_CLIENT_SECRET"),
    youtubeApiKey: optional(raw, "YOUTUBE_API_KEY"),
    // Ticketmaster's own cap is 100 search.list calls/day for the whole
    // project. Default a little under it so a manual test run cannot exhaust
    // the budget the weekly digest needs.
    youtubeDailySearchLimit: int(raw, "YOUTUBE_DAILY_SEARCH_LIMIT", 90),
    resendApiKey: optional(raw, "RESEND_API_KEY"),
    // "LikelyList", capitalised, because this string is the sender name an inbox
    // shows in its list view. The lowercase wordmark is a typographic treatment that
    // belongs on a page it can be styled on; rendered as plain text next to real
    // senders it just looks like a mistake.
    // No fallback sender. A default here would send from somebody else's domain
    // and look like it worked, which is worse than the send failing loudly.
    emailFrom: optional(raw, "EMAIL_FROM"),
    emailUnsubscribeMailto: optional(raw, "EMAIL_UNSUBSCRIBE_MAILTO"),
    siteUrl: optional(raw, "NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
    cronSecret: optional(raw, "CRON_SECRET"),
    unsubscribeHmacSecret: optional(raw, "UNSUBSCRIBE_HMAC_SECRET"),
  };
}

/** Throws with a specific message when an optional-at-boot key is actually used. */
export function requireKey(value: string, name: string, why: string): string {
  if (!value) {
    throw new Error(`${name} is not set, so ${why} is unavailable.`);
  }
  return value;
}
