import type { AdminClient } from "@/lib/supabase/admin";
import type { AppEnv } from "@/lib/env";
import {
  type ArtistPref,
  type ArtistRow,
  type CachedEvent,
  type City,
  type Genre,
  type GenrePref,
  type Profile,
} from "@/lib/db";
import { normalizeName } from "@/lib/normalize";
import {
  formatEventDate,
  formatEventTime,
  localDateString,
  zonedTimeToUtc,
} from "@/lib/time";
import { spotifySearchUrl, youtubeSearchUrl } from "@/lib/enrich/links";
import { createYoutubeBudget, resolveYoutube } from "@/lib/enrich/youtube";
import { signToken } from "@/lib/tokens";
import {
  MAX_EMAIL_EVENTS,
  MAX_ENRICHED_PERFORMERS,
  MAX_ONSALE_EVENTS,
  type Digest,
  type DigestEvent,
  type DigestOnsale,
  type DigestPerformer,
} from "./types";

/**
 * Assembles one subscriber's digest from the cached events.
 *
 * Reads only — the Ticketmaster fetching happens once per city in ./plan, well
 * before this runs. That split is the whole reason the quota works: two people
 * following Boston cost one API call, not two, and genre filtering happens here
 * in our own code against each event's primary genre ID.
 */

export type BuildOptions = {
  /** Inclusive local start date, `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive local end date, `YYYY-MM-DD`. */
  endDate: string;
  /** Skip YouTube enrichment. Used by the on-demand preview to stay fast. */
  skipEnrichment?: boolean;
};

export async function buildDigest(
  supabase: AdminClient,
  env: AppEnv,
  userId: string,
  options: BuildOptions,
): Promise<Digest | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, timezone, digest_send_hour, digest_enabled")
    .eq("id", userId)
    .maybeSingle<
      Pick<
        Profile,
        "id" | "email" | "timezone" | "digest_send_hour" | "digest_enabled"
      >
    >();

  if (!profile) return null;

  // The recipient comes from auth.users, not from profiles.email.
  //
  // Migration 0005 revokes the user's ability to write profiles.email, so the two
  // should agree — but the address that decides where mail is sent should be read
  // from the identity provider that verified it, so that loosening an RLS policy
  // later can never turn this service into a relay for unsolicited mail.
  const recipient = await resolveRecipient(supabase, userId, profile.email);
  if (!recipient) return null;

  const [subsResult, genrePrefsResult, artistPrefsResult, citiesResult, genresResult] =
    await Promise.all([
      supabase.from("subscriptions").select("city_id").eq("user_id", userId),
      supabase
        .from("genre_prefs")
        .select("genre_id, weight, source")
        .eq("user_id", userId)
        .gt("weight", 0),
      supabase
        .from("artist_prefs")
        .select("normalized_name, name, score")
        .eq("user_id", userId),
      supabase.from("cities").select("id, name, state_code"),
      supabase.from("genres").select("id, tm_genre_id, name"),
    ]);

  const cityIds = ((subsResult.data ?? []) as { city_id: number }[]).map(
    (row) => row.city_id,
  );
  if (cityIds.length === 0) {
    return emptyDigest({ ...profile, email: recipient }, env, options, []);
  }

  const cityById = new Map(
    ((citiesResult.data ?? []) as Pick<City, "id" | "name" | "state_code">[]).map(
      (city) => [city.id, city],
    ),
  );
  const genres = (genresResult.data ?? []) as Pick<
    Genre,
    "id" | "tm_genre_id" | "name"
  >[];
  const genreById = new Map(genres.map((genre) => [genre.id, genre]));

  // tm_genre_id -> weight, which is what the event rows can actually be matched
  // against.
  const weightByTmGenre = new Map<string, number>();
  const genreNameByTmId = new Map<string, string>();
  for (const genre of genres) genreNameByTmId.set(genre.tm_genre_id, genre.name);

  for (const pref of (genrePrefsResult.data ?? []) as Pick<
    GenrePref,
    "genre_id" | "weight" | "source"
  >[]) {
    const genre = genreById.get(pref.genre_id);
    if (genre) weightByTmGenre.set(genre.tm_genre_id, Number(pref.weight));
  }

  const artistScores = new Map<string, { name: string; score: number }>();
  for (const pref of (artistPrefsResult.data ?? []) as Pick<
    ArtistPref,
    "normalized_name" | "name" | "score"
  >[]) {
    artistScores.set(pref.normalized_name, {
      name: pref.name,
      score: Number(pref.score),
    });
  }

  const cityNames = cityIds
    .map((id) => cityById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  // Nothing to filter by.
  //
  // The alternative to a fallback here is a correct-but-useless email: a reader
  // who has followed a city and nothing else gets "Nothing matched this week",
  // every week, forever. That is worse than an unfiltered list, provided the
  // email admits which one it is sending — which is what `fallbackReason` and the
  // banner in the template are for.
  //
  // Signing up cannot land here any more (the subscribe box requires a genre), so
  // in practice this is reached by someone who has unfollowed everything in the
  // app. It is a safety net, not a normal path.
  const unfiltered = weightByTmGenre.size === 0 && artistScores.size === 0;

  const { data: eventRows } = await supabase
    .from("events_cache")
    .select(
      "city_id, tm_event_id, name, url, local_date, local_time, venue_name, venue_city, venue_state, image_url, tm_genre_id, attractions",
    )
    .in("city_id", cityIds)
    .gte("local_date", options.startDate)
    .lte("local_date", options.endDate)
    .order("local_date");

  const events = (eventRows ?? []) as CachedEvent[];

  // One event can be cached under several cities; keep the first.
  const seen = new Set<string>();
  const scored: DigestEvent[] = [];

  /** The genre/artist signal for one cached row. Shared with the onsale pass. */
  function signalFor(row: CachedEvent) {
    const genreWeight = row.tm_genre_id
      ? (weightByTmGenre.get(row.tm_genre_id) ?? 0)
      : 0;

    const matchedArtists: string[] = [];
    let artistBoost = 0;
    for (const performer of row.attractions ?? []) {
      const match = artistScores.get(normalizeName(performer.name));
      if (match) {
        matchedArtists.push(match.name);
        artistBoost += match.score;
      }
    }

    return {
      matchedArtists,
      // A show qualifies on either signal. An artist the user followed by hand is
      // worth including even if the genre is not one they follow.
      qualifies: unfiltered || genreWeight > 0 || artistBoost > 0,
      // Artist matches dominate, but are capped so one obsessively-fed artist
      // cannot crowd out the whole week.
      score: genreWeight + 3 * Math.min(artistBoost, 3),
    };
  }

  function cityLabelFor(row: CachedEvent): string {
    const city = cityById.get(row.city_id);
    return (
      row.venue_city ??
      [city?.name, city?.state_code].filter(Boolean).join(", ") ??
      ""
    );
  }

  for (const row of events) {
    if (seen.has(row.tm_event_id)) continue;
    seen.add(row.tm_event_id);

    const signal = signalFor(row);
    if (!signal.qualifies) continue;

    const cityLabel = cityLabelFor(row);

    scored.push({
      tmEventId: row.tm_event_id,
      name: row.name,
      url: row.url,
      dateLabel: row.local_date ? formatEventDate(row.local_date) : "Date TBA",
      timeLabel: formatEventTime(row.local_time),
      localDate: row.local_date ?? "",
      venueName: row.venue_name,
      cityLabel,
      imageUrl: row.image_url,
      genreName: row.tm_genre_id
        ? (genreNameByTmId.get(row.tm_genre_id) ?? null)
        : null,
      performers: (row.attractions ?? []).map((performer) => ({
        name: performer.name,
        isHeadliner: performer.is_headliner,
        tmUrl: performer.url,
        imageUrl: performer.image_url,
        // Replaced by real links during enrichment for the events that make the
        // email; a zero-quota search link is the floor.
        youtubeUrl: youtubeSearchUrl(performer.name),
        youtubeThumbnailUrl: null,
        spotifyUrl: spotifySearchUrl(performer.name),
      })),
      score: signal.score,
      matchedArtists: signal.matchedArtists,
    });
  }

  // Relevance first, date as the tie-break. In the unfiltered case every score is
  // 0, so this degrades to pure date order, which is the only defensible ordering
  // when there is nothing to rank by.
  scored.sort(
    (a, b) => b.score - a.score || a.localDate.localeCompare(b.localDate),
  );

  // --- On sale this week ------------------------------------------------------
  //
  // A separate query rather than a filter over `events`, because these events are
  // selected on their onsale instant and are usually months outside the digest's
  // date window. Anything already in the main list is skipped: it is the same show
  // twice, and the reader is better served seeing it where the full card is.
  //
  // The bounds are the reader's own week, derived from the same date strings the
  // rest of the digest uses rather than passed in, so no caller has to know about
  // this. An onsale is an absolute instant, so the local dates have to be zoned to
  // compare against it.
  const [onsaleFrom, onsaleTo] = onsaleWindow(
    options.startDate,
    options.endDate,
    profile.timezone,
  );

  const { data: onsaleRows } = await supabase
    .from("events_cache")
    .select(
      "city_id, tm_event_id, name, url, local_date, local_time, venue_name, venue_city, venue_state, image_url, tm_genre_id, attractions, onsale_start",
    )
    .in("city_id", cityIds)
    .gte("onsale_start", onsaleFrom.toISOString())
    .lt("onsale_start", onsaleTo.toISOString())
    .order("onsale_start");

  const onsaleSeen = new Set<string>();
  const onsale: DigestOnsale[] = [];

  for (const row of (onsaleRows ?? []) as CachedEvent[]) {
    if (!row.onsale_start) continue;
    if (seen.has(row.tm_event_id)) continue;
    if (onsaleSeen.has(row.tm_event_id)) continue;
    onsaleSeen.add(row.tm_event_id);

    const signal = signalFor(row);
    if (!signal.qualifies) continue;

    onsale.push({
      tmEventId: row.tm_event_id,
      name: row.name,
      url: row.url,
      dateLabel: row.local_date ? formatEventDate(row.local_date) : "Date TBA",
      venueName: row.venue_name,
      cityLabel: cityLabelFor(row),
      onsaleStart: row.onsale_start,
      matchedArtists: signal.matchedArtists,
      score: signal.score,
    });
  }

  // Soonest first, not most relevant first: this is a deadline list, and a drop on
  // Monday has to be read before one on Friday.
  onsale.sort(
    (a, b) =>
      a.onsaleStart.localeCompare(b.onsaleStart) || b.score - a.score,
  );

  if (!options.skipEnrichment) {
    await enrichPerformers(supabase, env, profile.timezone, scored);
  }

  return {
    userId,
    email: recipient,
    timezone: profile.timezone,
    windowLabel: windowLabel(options.startDate, options.endDate),
    events: scored,
    totalEventCount: scored.length,
    // Capped here rather than in the template so the plain-text part, the HTML and
    // the web view cannot disagree about what "this week's drops" contains.
    onsale: onsale.slice(0, MAX_ONSALE_EVENTS),
    cities: cityNames,
    fallbackReason: unfiltered ? "no_preferences" : null,
    previewUrl: await previewUrl(env, userId),
    unsubscribeUrl: await unsubscribeUrl(env, userId),
    unsubscribeMailto: env.emailUnsubscribeMailto || null,
    siteUrl: env.siteUrl,
  };
}

/**
 * Adds YouTube links to the performers that will actually be shown.
 *
 * Bounded twice over: only the events the email carries, and only up to
 * MAX_ENRICHED_PERFORMERS artists. The YouTube search budget is 100 calls a day
 * for the entire project, so an unbounded loop here would exhaust it on the
 * first few subscribers.
 */
async function enrichPerformers(
  supabase: AdminClient,
  env: AppEnv,
  timezone: string,
  events: DigestEvent[],
): Promise<void> {
  if (!env.youtubeApiKey) return;

  const budget = createYoutubeBudget(
    supabase,
    localDateString(timezone, new Date()),
    env.youtubeDailySearchLimit,
  );

  const targets: DigestPerformer[] = [];
  for (const event of events.slice(0, MAX_EMAIL_EVENTS)) {
    for (const performer of event.performers) {
      if (targets.length >= MAX_ENRICHED_PERFORMERS) break;
      targets.push(performer);
    }
  }
  if (targets.length === 0) return;

  const names = [...new Set(targets.map((p) => normalizeName(p.name)))];
  const { data: cachedRows } = await supabase
    .from("artists")
    .select(
      "tm_attraction_id, normalized_name, youtube_channel_id, youtube_uploads_playlist_id, youtube_video_id, youtube_looked_up_at",
    )
    .in("normalized_name", names);

  const cacheByName = new Map(
    ((cachedRows ?? []) as (Pick<
      ArtistRow,
      | "tm_attraction_id"
      | "youtube_channel_id"
      | "youtube_uploads_playlist_id"
      | "youtube_video_id"
      | "youtube_looked_up_at"
    > & { normalized_name: string })[]).map((row) => [row.normalized_name, row]),
  );

  // Resolve each distinct artist once, then fan the result out to every
  // performer slot with that name.
  const resolved = new Map<string, Awaited<ReturnType<typeof resolveYoutube>>>();

  for (const performer of targets) {
    const key = normalizeName(performer.name);
    if (!resolved.has(key)) {
      resolved.set(
        key,
        await resolveYoutube(
          { apiKey: env.youtubeApiKey, supabase, budget },
          performer.name,
          cacheByName.get(key) ?? null,
        ),
      );
    }
    const links = resolved.get(key)!;
    performer.youtubeUrl = links.youtubeUrl;
    performer.youtubeThumbnailUrl = links.youtubeThumbnailUrl;
  }
}

/**
 * The address Supabase Auth holds for this account.
 *
 * Falls back to profiles.email only if the admin lookup fails outright, so a
 * transient auth-API problem degrades to the previous behaviour rather than
 * dropping someone's digest. Returns null when neither is usable, which the
 * caller turns into a skipped job rather than a send to nowhere.
 */
async function resolveRecipient(
  supabase: AdminClient,
  userId: string,
  profileEmail: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (!error && data.user?.email) return data.user.email;
  } catch {
    // Fall through to the profile copy.
  }
  return profileEmail || null;
}

/**
 * The instants spanned by the digest's local date range, in the reader's zone.
 *
 * `startDate`/`endDate` are inclusive local dates; the returned range runs from
 * local midnight on the first to local midnight after the last, so it is
 * half-open and matches the `.gte()` / `.lt()` pair it feeds.
 *
 * Falls back to treating the dates as UTC if the timezone is not one Intl accepts,
 * which keeps a single malformed profile row from throwing away the section.
 */
function onsaleWindow(
  startDate: string,
  endDate: string,
  timeZone: string,
): [Date, Date] {
  const [y1, m1, d1] = startDate.split("-").map(Number);
  const [y2, m2, d2] = endDate.split("-").map(Number);

  try {
    const from = zonedTimeToUtc(timeZone, y1, m1, d1, 0);
    const dayAfterEnd = zonedTimeToUtc(timeZone, y2, m2, d2, 0);
    return [from, new Date(dayAfterEnd.getTime() + 24 * 60 * 60 * 1000)];
  } catch {
    return [
      new Date(Date.UTC(y1, m1 - 1, d1)),
      new Date(Date.UTC(y2, m2 - 1, d2 + 1)),
    ];
  }
}

async function emptyDigest(
  profile: Pick<Profile, "id" | "email" | "timezone">,
  env: AppEnv,
  options: BuildOptions,
  cities: string[],
): Promise<Digest> {
  return {
    userId: profile.id,
    email: profile.email,
    timezone: profile.timezone,
    windowLabel: windowLabel(options.startDate, options.endDate),
    events: [],
    totalEventCount: 0,
    onsale: [],
    cities,
    fallbackReason: null,
    previewUrl: await previewUrl(env, profile.id),
    unsubscribeUrl: await unsubscribeUrl(env, profile.id),
    unsubscribeMailto: env.emailUnsubscribeMailto || null,
    siteUrl: env.siteUrl,
  };
}

async function previewUrl(env: AppEnv, userId: string): Promise<string> {
  const token = await signToken(env.unsubscribeHmacSecret, "preview", userId);
  return `${env.siteUrl}/preview/digest/${token}`;
}

async function unsubscribeUrl(env: AppEnv, userId: string): Promise<string> {
  const token = await signToken(env.unsubscribeHmacSecret, "unsubscribe", userId);
  return `${env.siteUrl}/unsubscribe?t=${token}`;
}

function windowLabel(startDate: string, endDate: string): string {
  return `${formatShort(startDate)} – ${formatShort(endDate)}`;
}

function formatShort(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
