import {
  DEFAULT_LOCALE,
  LOCALE_HTML_LANG,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "./locales";
import { translator, type Translate } from "./messages";

/**
 * Resolves the locale for one request.
 *
 * Order of preference:
 *   1. an explicit `?lang=` — so a link can force a language, and so the pages
 *      opened from an email can be checked in every locale without changing
 *      browser settings
 *   2. `Accept-Language`
 *   3. English
 *
 * No cookie and no redirect. These pages are opened once from a mail client, and
 * a locale cookie would be a stateful thing to set on someone who has not signed
 * in — the header already says what they read.
 */
export function localeFromRequest(request: {
  headers: { get(name: string): string | null };
  nextUrl?: { searchParams: URLSearchParams };
  url?: string;
}): Locale {
  const explicit = readLangParam(request);
  if (isLocale(explicit)) return explicit;
  return localeFromAcceptLanguage(request.headers.get("accept-language"));
}

export type RequestI18n = {
  locale: Locale;
  htmlLang: string;
  t: Translate;
};

export function i18nFromRequest(request: Parameters<typeof localeFromRequest>[0]): RequestI18n {
  const locale = localeFromRequest(request);
  return {
    locale,
    htmlLang: LOCALE_HTML_LANG[locale] ?? LOCALE_HTML_LANG[DEFAULT_LOCALE],
    t: translator(locale),
  };
}

function readLangParam(
  request: Parameters<typeof localeFromRequest>[0],
): string | null {
  if (request.nextUrl) return request.nextUrl.searchParams.get("lang");
  if (request.url) {
    try {
      return new URL(request.url).searchParams.get("lang");
    } catch {
      return null;
    }
  }
  return null;
}
