import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type SpotifyState = {
  connected: boolean;
  lastImportedAt: string | null;
  lastArtistCount: number | null;
  needsReconnect: boolean;
};

/**
 * The reader's Spotify connection, or null when the server has no Spotify credentials.
 *
 * Uses the admin client because `spotify_links` is deny-all under RLS — it holds a
 * refresh token, so it is deliberately unreachable from any browser session. Scoped to
 * this one user by the eq() below.
 *
 * Returning null rather than an "unconnected" state hides the offer entirely on a
 * deployment with no Spotify app configured, which is better than a button that can only
 * fail.
 *
 * Shared by the /app header and the Artists section: the header needs it to decide
 * whether to offer the connect button at all, so this is read once per page render.
 */
export async function loadSpotifyState(
  userId: string,
): Promise<SpotifyState | null> {
  const env = readEnv();
  if (!env.spotifyClientId || !env.spotifyClientSecret) return null;

  const supabase = createAdminClient(env);
  const { data } = await supabase
    .from("spotify_links")
    .select("last_imported_at, last_artist_count, invalid_since")
    .eq("user_id", userId)
    .maybeSingle<{
      last_imported_at: string | null;
      last_artist_count: number | null;
      invalid_since: string | null;
    }>();

  return {
    connected: Boolean(data),
    lastImportedAt: data?.last_imported_at ?? null,
    lastArtistCount: data?.last_artist_count ?? null,
    needsReconnect: Boolean(data?.invalid_since),
  };
}
