import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { signToken } from "@/lib/tokens";
import { authorizeUrl } from "@/lib/spotify/client";
import { spotifyRedirectUri } from "@/lib/spotify/redirect";

/**
 * Starts the Spotify connect.
 *
 * GET rather than POST because it is a plain navigation to a third-party consent
 * screen — nothing changes on our side until the callback comes back, so there is no
 * state to protect against a prefetch.
 *
 * `state` is an HMAC over the signed-in user's id (lib/tokens), which does two jobs at
 * once: it proves the callback belongs to a flow we started, and it tells the callback
 * *whose* account to attach the token to without trusting anything in the URL.
 */
export async function GET(request: NextRequest) {
  const env = readEnv();
  const origin = new URL(request.url).origin;

  const user = await getUser();
  if (!user) {
    // Back to this same route, not to the editor: connecting Spotify is what they
    // asked for, so signing in should finish that rather than leave them somewhere
    // near it. The emailed link carries `next` through — the auth templates build on
    // {{ .RedirectTo }}, which is the emailRedirectTo the login form sends — so
    // clicking it returns here with a session and the flow continues into Spotify.
    //
    // Degrades safely if the Redirect URLs allow-list drops it: Supabase falls back to
    // the Site URL, and the connect button is in the /app header either way.
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent("/api/spotify/connect")}`, origin),
    );
  }

  if (!env.spotifyClientId || !env.spotifyClientSecret) {
    return NextResponse.redirect(
      new URL("/app/subscriptions?spotify=not_configured", origin),
    );
  }

  const state = await signToken(env.unsubscribeHmacSecret, "spotify", user.id);

  return NextResponse.redirect(
    authorizeUrl({
      clientId: env.spotifyClientId,
      redirectUri: spotifyRedirectUri(origin),
      state,
    }),
  );
}
