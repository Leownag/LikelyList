/**
 * Signed, stateless tokens for links that arrive without a session.
 *
 * A one-click unsubscribe is a POST from a mail client with no cookies, and the
 * "view in browser" link is opened from an inbox weeks later. Neither can
 * authenticate, so the link itself carries proof — an HMAC over the purpose, the
 * user id, and the moment it was issued. Nothing is stored server-side, and
 * rotating UNSUBSCRIBE_HMAC_SECRET invalidates every outstanding link at once.
 *
 * Built on Web Crypto so the same code runs in the Workers runtime and in Node.
 *
 * The two purposes have deliberately different lifetimes:
 *
 *   unsubscribe — never expires. A recipient must always be able to get out,
 *                 including from an email they find a year later. An expired
 *                 unsubscribe link is a deliverability and consent problem, not
 *                 a security win.
 *   preview     — expires. It exposes which cities and artists someone follows,
 *                 so a forwarded or leaked email should stop being a readable
 *                 window into their account after a week.
 */

/**
 * `subscribe` is the double opt-in confirmation link. For that purpose the signed
 * subject is a `pending_subscriptions.id`, not a user id — there is no user yet.
 */
export type TokenPurpose = "unsubscribe" | "preview" | "subscribe";

/** How long a "view in browser" link stays readable. */
export const PREVIEW_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a confirmation link is good for. Matches the `expires_at` default on
 * pending_subscriptions, so the row and the link stop working together.
 */
export const SUBSCRIBE_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * `<payload>.<signature>`, both base64url.
 *
 * Payload is `purpose:userId:issuedAtMs:extra`. The issue time is inside the
 * signed region, so it cannot be edited to extend a token's life.
 */
export async function signToken(
  secret: string,
  purpose: TokenPurpose,
  userId: string,
  extra = "",
  issuedAt: number = Date.now(),
): Promise<string> {
  if (!secret) {
    throw new Error(
      "UNSUBSCRIBE_HMAC_SECRET is not set, so signed links cannot be created.",
    );
  }
  const payload = `${purpose}:${userId}:${issuedAt}:${extra}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${base64UrlEncode(encoder.encode(payload))}.${base64UrlEncode(
    new Uint8Array(signature),
  )}`;
}

export type VerifiedToken = {
  /**
   * The signed subject. A user id for `unsubscribe` and `preview`; a
   * `pending_subscriptions.id` for `subscribe`.
   */
  userId: string;
  extra: string;
  issuedAt: number;
};

/**
 * Verifies a token and returns its claims, or null.
 *
 * Verification goes through crypto.subtle.verify rather than comparing strings,
 * so the comparison is constant-time and cannot be probed by timing.
 *
 * `maxAgeMs` is opt-in per call site so unsubscribe links stay permanent while
 * preview links expire.
 */
export async function verifyToken(
  secret: string,
  purpose: TokenPurpose,
  token: string | null | undefined,
  { maxAgeMs, now = Date.now() }: { maxAgeMs?: number; now?: number } = {},
): Promise<VerifiedToken | null> {
  if (!secret || !token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payloadPart = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);

  let payload: string;
  let signature: Uint8Array;
  try {
    payload = new TextDecoder().decode(base64UrlDecode(payloadPart));
    signature = base64UrlDecode(signaturePart);
  } catch {
    return null;
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature as unknown as ArrayBuffer,
    encoder.encode(payload),
  );
  if (!valid) return null;

  // Purpose is part of the signed payload, so an unsubscribe token cannot be
  // replayed as a preview token or vice versa.
  const [tokenPurpose, userId, issuedAtText, ...rest] = payload.split(":");
  if (tokenPurpose !== purpose || !userId) return null;

  const issuedAt = Number(issuedAtText);
  if (!Number.isFinite(issuedAt)) return null;

  if (maxAgeMs !== undefined) {
    const age = now - issuedAt;
    // A token from the future is as suspect as an expired one; a little slack
    // absorbs clock skew between the signing and verifying machines.
    if (age > maxAgeMs || age < -60_000) return null;
  }

  return { userId, extra: rest.join(":"), issuedAt };
}
