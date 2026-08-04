import type { AdminClient } from "@/lib/supabase/admin";
import type { AppEnv } from "@/lib/env";
import { normalizeName } from "@/lib/normalize";
import { spotifyRankScore } from "@/lib/artist-score";
import {
  SpotifyAuthError,
  fetchTopArtists,
  refreshAccessToken,
} from "./client";

/**
 * Top artists → `artist_prefs`. That is the entire feature.
 *
 * Nothing else about the Spotify response is used or stored: no images (their URLs
 * expire, and a digest sits in an inbox for weeks), no genres, no audio features. The
 * screenshot reader already covers the fuzzy cases; this covers the exact one.
 */

/** How long a connection may go unrefreshed before the drainer re-imports. */
export const IMPORT_INTERVAL_DAYS = 30;


export type ImportOutcome =
  | { status: "imported"; artistCount: number }
  | { status: "not_connected" }
  /** The grant is dead. The caller marks it and the UI offers a reconnect. */
  | { status: "needs_reconnect"; reason: string }
  | { status: "error"; reason: string };

type LinkRow = {
  user_id: string;
  refresh_token: string;
};

/**
 * Re-imports one reader's top artists.
 *
 * Writes are an overwrite rather than an increment, which matters for something that
 * runs monthly: incrementing would inflate the same fifty artists forever until they
 * drowned out everything the reader chose themselves.
 *
 * And it will not touch a row whose source is `explicit`. Somebody who searched for a
 * band by hand has said something more specific than their listening history does, and
 * a background job quietly lowering that score a month later would be the kind of bug
 * nobody ever reports — they would just notice the digest got worse.
 */
export async function importTopArtists(
  supabase: AdminClient,
  env: AppEnv,
  userId: string,
): Promise<ImportOutcome> {
  if (!env.spotifyClientId || !env.spotifyClientSecret) {
    return { status: "error", reason: "Spotify is not configured on this server." };
  }

  const { data: link } = await supabase
    .from("spotify_links")
    .select("user_id, refresh_token")
    .eq("user_id", userId)
    .maybeSingle<LinkRow>();

  if (!link) return { status: "not_connected" };

  let accessToken: string;
  try {
    const tokens = await refreshAccessToken({
      clientId: env.spotifyClientId,
      clientSecret: env.spotifyClientSecret,
      refreshToken: link.refresh_token,
    });
    accessToken = tokens.accessToken;

    // Spotify rotates refresh tokens sometimes. Missing the rotation means the next
    // run fails with invalid_grant and the reader is told to reconnect for no reason.
    if (tokens.refreshToken && tokens.refreshToken !== link.refresh_token) {
      await supabase
        .from("spotify_links")
        .update({ refresh_token: tokens.refreshToken })
        .eq("user_id", userId);
    }
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return { status: "needs_reconnect", reason: error.message };
    }
    return { status: "error", reason: describe(error) };
  }

  let artists;
  try {
    artists = await fetchTopArtists(accessToken, 50);
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return { status: "needs_reconnect", reason: error.message };
    }
    return { status: "error", reason: describe(error) };
  }

  const written = await writeArtistPrefs(supabase, userId, artists);

  await supabase
    .from("spotify_links")
    .update({
      last_imported_at: new Date().toISOString(),
      last_artist_count: written,
      invalid_since: null,
      last_error: null,
    })
    .eq("user_id", userId);

  return { status: "imported", artistCount: written };
}

export type ArtistPrefRow = {
  user_id: string;
  name: string;
  normalized_name: string;
  tm_attraction_id: null;
  score: number;
  source: "spotify";
  last_seen_at: string;
};

/**
 * Spotify's ordered list → rows ready to upsert.
 *
 * Pure and exported so the two things that can go wrong here are testable without a
 * database:
 *
 *  - **Duplicates.** Two Spotify entries can normalise to the same key ("Sigur Rós"
 *    and "Sigur Ros"), and `artist_prefs` is unique on (user_id, normalized_name). A
 *    duplicate inside one upsert makes Postgres reject the entire statement, not the
 *    row — so all fifty artists would be lost to one collision.
 *  - **The score taper.** It has to stay inside its band no matter how many artists
 *    come back, and must never reach the score a hand-typed artist gets.
 */
export function buildArtistRows(
  userId: string,
  artists: { id: string; name: string }[],
  now = new Date().toISOString(),
): ArtistPrefRow[] {
  const seen = new Set<string>();
  const rows: ArtistPrefRow[] = [];

  artists.forEach((artist, index) => {
    const normalized = normalizeName(artist.name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);

    rows.push({
      user_id: userId,
      name: artist.name,
      normalized_name: normalized,
      // Spotify's id is not Ticketmaster's, and guessing a mapping would be worse
      // than leaving this null — digest matching runs on the normalised name anyway.
      tm_attraction_id: null,
      // Spread across the band by position in Spotify's own ordering, computed from
      // the input length rather than an assumed 50 — a new account can come back with
      // one artist, which is the case that used to produce NaN.
      score: spotifyRankScore(index, artists.length),
      source: "spotify",
      last_seen_at: now,
    });
  });

  return rows;
}

async function writeArtistPrefs(
  supabase: AdminClient,
  userId: string,
  artists: { id: string; name: string }[],
): Promise<number> {
  if (artists.length === 0) return 0;

  const rows = buildArtistRows(userId, artists);
  if (rows.length === 0) return 0;

  // Which of these already exist, and how they got there. An `explicit` row is left
  // exactly as it is.
  const { data: existing } = await supabase
    .from("artist_prefs")
    .select("normalized_name, source")
    .eq("user_id", userId)
    .in(
      "normalized_name",
      rows.map((row) => row.normalized_name),
    );

  const handPicked = new Set(
    ((existing ?? []) as { normalized_name: string; source: string }[])
      .filter((row) => row.source === "explicit")
      .map((row) => row.normalized_name),
  );

  const writable = rows.filter((row) => !handPicked.has(row.normalized_name));
  if (writable.length === 0) return 0;

  const { error } = await supabase
    .from("artist_prefs")
    .upsert(writable, { onConflict: "user_id,normalized_name" });

  if (error) throw new Error(`Writing artist preferences failed: ${error.message}`);

  await retireDroppedArtists(supabase, userId, rows);

  return writable.length;
}

/**
 * Removes artists this import no longer lists.
 *
 * Without this the follow list only ever grew. Each monthly run wrote the current top
 * 50 and left everybody who had fallen out exactly where they were, so after a year a
 * reader's list was the union of twelve months of top fifties — two or three hundred
 * names — and their digest filled up with what they were listening to last spring. It
 * degrades steadily, and it is close to impossible for the reader to diagnose: nothing
 * looks broken, the recommendations just quietly stop being about them.
 *
 * Scoped hard to `source = 'spotify'`. A name they typed in, or one a screenshot found,
 * is theirs and is not Spotify's to retract — deleting those would be this function
 * silently undoing work the reader did by hand.
 */
async function retireDroppedArtists(
  supabase: AdminClient,
  userId: string,
  current: ArtistPrefRow[],
): Promise<void> {
  const keep = current.map((row) => row.normalized_name);

  const query = supabase
    .from("artist_prefs")
    .delete()
    .eq("user_id", userId)
    .eq("source", "spotify");

  // An empty `keep` would make the `not in ()` filter invalid, and an import that
  // returned nothing is far more likely to be a bad response than a genuinely empty
  // library — so nothing is retired in that case.
  if (keep.length === 0) return;

  // The filter below is a string, so a name containing `)` or `,` would change what it
  // means rather than fail to parse — and this statement deletes rows. Every value here
  // has been through normalizeName, which leaves only lowercase alphanumerics and
  // single spaces, so that cannot currently happen; asserting it here means a future
  // relaxation of normalizeName (to keep accents, say) stops the retire instead of
  // silently deleting the wrong follows. Skipping a retire costs a stale artist.
  const unsafe = keep.filter((name) => /[^a-z0-9 ]/.test(name));
  if (unsafe.length > 0) {
    console.error(
      "[SPOTIFY_RETIRE] refusing to retire: unexpected characters in",
      unsafe.slice(0, 3),
    );
    return;
  }

  const { error } = await query.not(
    "normalized_name",
    "in",
    `(${keep.map((name) => `"${name}"`).join(",")})`,
  );

  if (error) {
    // Not fatal. A stale extra artist is a much smaller problem than a failed import,
    // and the next run will try again.
    console.error("[SPOTIFY_RETIRE]", error.message);
  }
}

/**
 * Readers whose import is due.
 *
 * Ordered oldest-first so a backlog drains fairly rather than starving whoever
 * connected earliest, and bounded because this runs inside the five-minute drainer.
 */
export async function findDueImports(
  supabase: AdminClient,
  limit: number,
): Promise<string[]> {
  const cutoff = new Date(
    Date.now() - IMPORT_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await supabase
    .from("spotify_links")
    .select("user_id, last_imported_at")
    .is("invalid_since", null)
    .or(`last_imported_at.is.null,last_imported_at.lt.${cutoff}`)
    .order("last_imported_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  return ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
}

/** Records a dead grant so the UI can offer a reconnect and the drainer stops trying. */
export async function markNeedsReconnect(
  supabase: AdminClient,
  userId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("spotify_links")
    .update({ invalid_since: new Date().toISOString(), last_error: reason })
    .eq("user_id", userId);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
