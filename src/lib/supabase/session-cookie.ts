/**
 * Reads the expiry out of the Supabase auth cookie without going through the
 * client.
 *
 * Why by hand: every way of *asking* auth-js about the session — getUser(),
 * getSession(), getClaims() — routes through __loadSession, and __loadSession is
 * the thing that rotates the refresh token. A server component cannot persist that
 * rotation (see supabase/server.ts), so it has to be avoided rather than observed.
 */
import { stringFromBase64URL } from "@supabase/ssr";

/** `sb-<project ref>-auth-token`, plus `.0`/`.1`/… when @supabase/ssr chunks it. */
const AUTH_COOKIE = /^sb-.+-auth-token(?:\.(\d+))?$/;

/**
 * auth-js refreshes this far *ahead* of the real expiry (EXPIRY_MARGIN_MS in
 * @supabase/auth-js/lib/constants), so a token has to be fresher than this for a
 * read to be refresh-free.
 */
export const REFRESH_MARGIN_MS = 90_000;

/** True when reading the session will not make auth-js rotate the refresh token. */
export function accessTokenIsFresh(
  cookies: { name: string; value: string }[],
  now = Date.now(),
): boolean {
  const raw = cookies
    .flatMap((cookie) => {
      const match = AUTH_COOKIE.exec(cookie.name);
      // Numeric, not lexicographic: `.10` sorts before `.2` as a string.
      return match ? [{ index: Number(match[1] ?? 0), value: cookie.value }] : [];
    })
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.value)
    .join("");
  if (!raw) return false;

  try {
    const json = raw.startsWith("base64-")
      ? stringFromBase64URL(raw.slice("base64-".length))
      : raw;
    const { expires_at: expiresAt } = JSON.parse(json) as { expires_at?: number };
    return typeof expiresAt === "number" && expiresAt * 1000 - now > REFRESH_MARGIN_MS;
  } catch {
    // Truncated or unrecognised cookie. Treating it as stale costs one anonymous
    // render; treating it as fresh would hand auth-js the token to burn.
    return false;
  }
}
