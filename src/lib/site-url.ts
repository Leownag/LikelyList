import { DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n/locales";

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

/**
 * Where one locale's copy of `path` lives.
 *
 * English is the bare path and every other locale hangs off `?lang=`, which is the only
 * thing that makes a translation separately crawlable: the locale is otherwise resolved
 * from a cookie and `Accept-Language` (`lib/i18n/server.ts`), and Google crawls with
 * neither — so without a distinct URL there is nothing for `hreflang` to point at and the
 * translations are invisible to search no matter how good they are.
 */
export function localePath(path: string, locale: Locale): string {
  return locale === DEFAULT_LOCALE ? path : `${path}?lang=${locale}`;
}

/**
 * The `hreflang` set for one path, as Next's `alternates.languages` wants it.
 *
 * `x-default` points at English: it is what a reader gets when none of the declared
 * languages match, which is exactly what the cookie-less default already does.
 *
 * Only add a locale here once its copy for `path` is actually translated. Annotating a
 * page as another language while it still serves English is worse than saying nothing —
 * it asks Google to treat two identical pages as alternates of each other.
 */
export function localeAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = { "x-default": path };
  for (const locale of LOCALES) languages[locale] = localePath(path, locale);
  return languages;
}
