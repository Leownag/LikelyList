/**
 * The site's public origin, without pulling in the full env reader.
 *
 * `readEnv()` hard-requires the Supabase variables, which is right for anything
 * that talks to the database but wrong for robots.txt, the sitemap and the privacy
 * page: those are static, need nothing but the origin, and should not make
 * `next build` fail on a clone that has no credentials yet.
 */
export function siteUrlFromEnv(): string {
  const value = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  // Trailing slashes would produce "//privacy" once concatenated.
  return (value || "http://localhost:3000").replace(/\/+$/, "");
}
