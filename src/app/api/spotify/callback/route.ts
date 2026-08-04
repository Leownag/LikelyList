import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { SPOTIFY_STATE_MAX_AGE_MS, verifyToken } from "@/lib/tokens";
import {
  exchangeCode,
  fetchSpotifyUserId,
  SPOTIFY_SCOPE,
} from "@/lib/spotify/client";
import { spotifyRedirectUri } from "@/lib/spotify/redirect";
import { importTopArtists } from "@/lib/spotify/import";

/**
 * Finishes the Spotify connect, then imports immediately.
 *
 * Importing here rather than waiting for the drainer is the difference between
 * "connected" meaning something and meaning nothing: somebody who just clicked through
 * a consent screen should land back on a page that already lists their artists, not one
 * that promises to do it within five minutes.
 *
 * The user id comes from the signed `state`, never from a session — the browser
 * returning from Spotify may have lost one, and the state is the thing that proves
 * which flow this is anyway.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const env = readEnv();

  const back = (params: string) =>
    NextResponse.redirect(new URL(`/app/subscriptions?${params}`, url.origin));

  // The reader declined at the consent screen. Not an error, and not worth a scary
  // message — they simply changed their mind.
  const denied = url.searchParams.get("error");
  if (denied) return back("spotify=cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("spotify=invalid");

  const verified = await verifyToken(
    env.unsubscribeHmacSecret,
    "spotify",
    state,
    { maxAgeMs: SPOTIFY_STATE_MAX_AGE_MS },
  );
  if (!verified) return back("spotify=expired");

  if (!env.spotifyClientId || !env.spotifyClientSecret) {
    return back("spotify=not_configured");
  }

  const userId = verified.userId;
  const supabase = createAdminClient(env);

  try {
    const tokens = await exchangeCode({
      clientId: env.spotifyClientId,
      clientSecret: env.spotifyClientSecret,
      code,
      // Must be byte-identical to the one sent to /authorize, which is why both come
      // from the same helper.
      redirectUri: spotifyRedirectUri(url.origin),
    });

    if (!tokens.refreshToken) {
      // Without one there is nothing to refresh from next month, so the connection
      // would silently be a one-off.
      return back("spotify=no_refresh_token");
    }

    // A scope can be narrowed at the consent screen. Saying so now beats an importer
    // that quietly returns nothing forever.
    if (tokens.scope && !tokens.scope.includes(SPOTIFY_SCOPE)) {
      return back("spotify=missing_scope");
    }

    await supabase.from("spotify_links").upsert(
      {
        user_id: userId,
        refresh_token: tokens.refreshToken,
        spotify_user_id: await fetchSpotifyUserId(tokens.accessToken),
        scope: tokens.scope,
        connected_at: new Date().toISOString(),
        // Cleared so a reconnect after a revoked grant actually recovers.
        invalid_since: null,
        last_error: null,
      },
      { onConflict: "user_id" },
    );

    const outcome = await importTopArtists(supabase, env, userId);

    if (outcome.status === "imported") {
      return back(`spotify=connected&artists=${outcome.artistCount}`);
    }
    // Connected but the first import did not land. The link is saved, so the drainer
    // will retry — say connected rather than failed, because that is what happened.
    return back("spotify=connected_no_import");
  } catch (error) {
    console.error("[SPOTIFY_CALLBACK]", error);
    return back("spotify=failed");
  }
}
