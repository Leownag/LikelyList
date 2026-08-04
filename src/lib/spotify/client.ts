/**
 * Spotify Web API, as narrowly as possible.
 *
 * Three calls exist here and no more: exchange a code, refresh an access token, read
 * the top artists. The integration answers exactly one question — who does this
 * person actually listen to — and everything else Spotify offers is either already
 * covered (the screenshot reader) or deliberately declined (images expire, and genre
 * analysis is not wanted).
 *
 * `user-top-read` is the only scope requested. A token that cannot read a playlist
 * cannot leak one, and the consent screen says so plainly, which matters when you are
 * asking somebody to connect their music account to a mailing list.
 */

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

/** The only scope. See the header. */
export const SPOTIFY_SCOPE = "user-top-read";

/** Third-party calls on a request path get a short leash. */
const TIMEOUT_MS = 8000;

export type SpotifyTokens = {
  accessToken: string;
  /**
   * Absent on a refresh, which is normal: Spotify only re-issues one when it decides
   * to rotate. The caller keeps the token it already has in that case.
   */
  refreshToken: string | null;
  scope: string | null;
  expiresInSeconds: number;
};

export type SpotifyArtist = {
  id: string;
  name: string;
};

/** Distinguishes "reconnect needed" from "try again later", which the caller treats very differently. */
export class SpotifyAuthError extends Error {}

export function authorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    scope: SPOTIFY_SCOPE,
    redirect_uri: options.redirectUri,
    state: options.state,
    // Forces the consent screen even for a returning user. Wanted here: this is the
    // screen that shows how little is being asked for, and silently re-granting makes
    // a reconnect feel like it did nothing.
    show_dialog: "true",
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

/**
 * Basic auth with the client secret, rather than PKCE.
 *
 * Correct because this is a confidential client: the exchange happens on the server
 * and the secret never reaches a browser. PKCE exists for clients that cannot keep a
 * secret, and pretending to be one would only add a code verifier to carry around.
 */
function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

async function requestToken(
  clientId: string,
  clientSecret: string,
  body: Record<string, string>,
): Promise<SpotifyTokens> {
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();

  if (!response.ok) {
    // 400 with invalid_grant is the one that will never fix itself: the user revoked
    // access, or the token was already rotated away. Everything else — 429, 5xx, a
    // network blip — is worth retrying on the next pass.
    if (response.status === 400 && text.includes("invalid_grant")) {
      throw new SpotifyAuthError(
        "Spotify rejected the saved authorisation. It needs reconnecting.",
      );
    }
    throw new Error(`Spotify token request failed: HTTP ${response.status} ${text}`);
  }

  const parsed = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };

  if (!parsed.access_token) {
    throw new Error("Spotify returned no access token.");
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    scope: parsed.scope ?? null,
    expiresInSeconds: parsed.expires_in ?? 3600,
  };
}

export function exchangeCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<SpotifyTokens> {
  return requestToken(options.clientId, options.clientSecret, {
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
  });
}

export function refreshAccessToken(options: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<SpotifyTokens> {
  return requestToken(options.clientId, options.clientSecret, {
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
  });
}

/**
 * The reader's top artists, most-listened first.
 *
 * `time_range` is `medium_term` — roughly the last six months. Not `short_term`, which
 * swings on a single week's listening, and not `long_term`, which keeps recommending
 * shows for a phase somebody left two years ago. Six months is the horizon that
 * matches "who would you go and see".
 *
 * Only `id` and `name` are kept. Spotify also returns images, genres, popularity and
 * followers; none of it is wanted, and taking it would mean storing it.
 */
export async function fetchTopArtists(
  accessToken: string,
  limit = 50,
): Promise<SpotifyArtist[]> {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(limit, 1), 50)),
    time_range: "medium_term",
  });

  const response = await fetch(`${API}/me/top/artists?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw new SpotifyAuthError(
      "Spotify refused the access token. The connection needs renewing.",
    );
  }
  if (!response.ok) {
    throw new Error(`Spotify top artists failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    items?: { id?: string; name?: string }[];
  };

  return (body.items ?? [])
    .filter((item): item is { id: string; name: string } =>
      Boolean(item.id && item.name),
    )
    .map((item) => ({ id: item.id, name: item.name }));
}

/** Spotify's own user id, for answering "which account is this?" later. */
export async function fetchSpotifyUserId(
  accessToken: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { id?: string };
    return body.id ?? null;
  } catch {
    // Cosmetic. Never worth failing a connection over.
    return null;
  }
}
