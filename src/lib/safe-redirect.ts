/**
 * Same-origin redirect target validation.
 *
 * Its own module so it can be unit-tested directly, because getting it wrong is
 * an open redirect on a URL that legitimately completes a real sign-in — the most
 * convincing shape a phishing link can take.
 *
 * Two rules, and the second is the one that is easy to miss:
 *
 *   1. The value must be a relative path starting with `/`. Anything carrying a
 *      scheme is rejected outright.
 *   2. It is then resolved against the real origin and the origins compared.
 *      A string check alone is not enough: for http(s) URLs the WHATWG parser
 *      treats a backslash as a path separator, so `/\evil.com` satisfies
 *      "starts with / but not //" and still resolves to `https://evil.com/`.
 *      Resolving and comparing defers the decision to the same parser the
 *      browser will use, instead of trying to enumerate hostile encodings.
 */

const DEFAULT_TARGET = "/app";

export function safeRedirectPath(
  value: string | null | undefined,
  origin: string,
  fallback: string = DEFAULT_TARGET,
): string {
  if (!value || !value.startsWith("/")) return fallback;

  let resolved: URL;
  let base: URL;
  try {
    base = new URL(origin);
    resolved = new URL(value, base);
  } catch {
    return fallback;
  }

  if (resolved.origin !== base.origin) return fallback;

  // Rebuilt from the parsed URL rather than returned verbatim, so whatever
  // normalisation the parser applied is what actually gets used downstream.
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return path.startsWith("/") ? path : fallback;
}
