/**
 * The redirect URI, in one place.
 *
 * Spotify compares this string **exactly** against the list registered in the
 * dashboard, on both the authorize call and the token exchange, and the two must match
 * each other as well. Deriving it twice is how you get an `invalid_grant` that looks
 * like a broken token rather than a mismatched string.
 *
 * Built from the request origin rather than NEXT_PUBLIC_SITE_URL so localhost works
 * without reconfiguring anything — which does mean both origins have to be registered
 * with Spotify. See the README.
 */
export function spotifyRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/spotify/callback`;
}
