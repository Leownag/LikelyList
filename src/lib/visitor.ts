/**
 * A stable, non-reversible key for an anonymous caller.
 *
 * Cloudflare provides the client IP in `CF-Connecting-IP`. It is hashed with the
 * app secret and truncated, so what ends up in the counters table identifies a
 * repeat caller without recording who they are.
 *
 * Lives here rather than inside one route because two public endpoints now need
 * the same key: /api/explore, which is rationing a 5000/day Ticketmaster quota,
 * and /api/places/search, which is rationing our own database.
 */
export async function visitorHash(
  request: Request,
  secret: string,
): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  // Without a secret there is nothing to key an HMAC with. Returning a constant
  // rather than the raw IP keeps an unconfigured deployment from writing
  // addresses into the counters table; the cap then applies to everyone at once,
  // which is the safe direction to fail.
  if (!secret) return ip === "unknown" ? "unknown" : "unkeyed";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );

  return [...new Uint8Array(signature)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
