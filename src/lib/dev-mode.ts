/**
 * Dev mode: see error codes and raw detail in production, without showing them to
 * anyone else.
 *
 * Not an environment variable. A global flag would either be off (useless when you
 * need to diagnose the live site) or on for every visitor (which is what leaking
 * upstream errors looked like in the first place). Instead it is a per-browser
 * cookie, set by visiting `/dev-mode?key=<CRON_SECRET>`.
 *
 * Reuses CRON_SECRET rather than adding another variable: it is already a
 * high-entropy operator-only secret with the same blast radius, and one fewer
 * thing to rotate. The cookie stores an HMAC of a fixed string, so the secret
 * itself never sits in the browser.
 *
 * Outside production it is on by default — during local development the whole
 * point is to see everything.
 */

export const DEV_MODE_COOKIE = "likelylist_dev";

const encoder = new TextEncoder();

/** The cookie value for a given secret. Not reversible to the secret. */
export async function devModeToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("dev-mode/v1"),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Whether this request should see error codes and detail.
 *
 * `cookieValue` is passed in rather than read here so the same function works
 * from a route handler, a server component and a server action, which all reach
 * cookies differently.
 */
export async function isDevMode({
  cookieValue,
  secret,
}: {
  cookieValue: string | undefined;
  secret: string;
}): Promise<boolean> {
  // Local development always shows everything.
  if (process.env.NODE_ENV !== "production") return true;
  if (!cookieValue || !secret) return false;

  const expected = await devModeToken(secret);
  return timingSafeEqual(cookieValue, expected);
}

/**
 * Length-independent comparison.
 *
 * The cookie is a bearer credential, so a plain `===` would leak its prefix
 * through response timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let mismatch = left.length === right.length ? 0 : 1;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}
