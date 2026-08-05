import type { MetadataRoute } from "next";
import { siteUrlFromEnv, localePath, localeAlternates } from "@/lib/site-url";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/lib/i18n/locales";

/**
 * The pages that should be indexed: three of them, one URL per page per served locale.
 *
 * Everything else is either behind sign-in or carries a token in the URL, so
 * listing it would be actively harmful rather than merely useless. Keep this in
 * agreement with the disallow list in robots.ts — sitemap.test.ts asserts it.
 *
 * Only the landing page carries hreflang, because it is the only one whose copy is
 * actually translated. `/explore` and `/privacy` are English on every locale, and
 * annotating them as alternates of themselves would be a claim that is not true.
 *
 * The `?lang=` URLs are listed as their own entries as well as being named in the
 * alternates: Google treats a sitemap entry as a crawl candidate and the alternates as a
 * relationship between candidates, and the Chinese page needs to be both.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = siteUrlFromEnv();
  const languages = Object.fromEntries(
    Object.entries(localeAlternates("/")).map(([key, path]) => [key, `${siteUrl}${path}`]),
  );

  return [
    ...ENABLED_LOCALES.map((locale) => ({
      url: `${siteUrl}${localePath("/", locale)}`,
      changeFrequency: "weekly" as const,
      // English stays the primary. The translation is a real page, not an equal one — it
      // is the same product described for a smaller audience.
      priority: locale === DEFAULT_LOCALE ? 1 : 0.9,
      alternates: { languages },
    })),
    // Daily: the listings roll forward a day at a time, so the page is never the same
    // twice even though the URL is.
    { url: `${siteUrl}/explore`, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
