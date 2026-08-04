/**
 * Signed, stateless tokens for links that arrive without a session.
 *
 * A one-click unsubscribe is a POST from a mail client with no cookies, and the
 * "view in browser" link is opened from an inbox weeks later. Neither can
 * authenticate, so the link itself has to carry proof — an HMAC over the user id
 * and purpose. Nothing is stored, and rotating UNSUBSCRIBE_HMAC_SECRET
 * invalidates every outstanding link at once.
 *
 * Built on Web Crypto so the same code runs in the Workers runtime and in Node.
 */

export type TokenPurpose = "unsubscribe" | "preview";

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

/** `<payload>.<signature>`, both base64url. */
export async function signToken(
  secret: string,
  purpose: TokenPurpose,
  userId: string,
  extra = "",
): Promise<string> {
  if (!secret) {
    throw new Error(
      "UNSUBSCRIBE_HMAC_SECRET is not set, so signed links cannot be created.",
    );
  }
  const payload = `${purpose}:${userId}:${extra}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${base64UrlEncode(encoder.encode(payload))}.${base64UrlEncode(
    new Uint8Array(signature),
  )}`;
}

export type VerifiedToken = { userId: string; extra: string };

/**
 * Verifies a token and returns its claims, or null.
 *
 * Verification goes through crypto.subtle.verify rather than comparing strings,
 * so the comparison is constant-time and cannot be probed by timing.
 */
export async function verifyToken(
  secret: string,
  purpose: TokenPurpose,
  token: string | null | undefined,
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
  const [tokenPurpose, userId, ...rest] = payload.split(":");
  if (tokenPurpose !== purpose || !userId) return null;

  return { userId, extra: rest.join(":") };
}
