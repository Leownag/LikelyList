import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_HTML_LANG,
  LOCALE_LABELS,
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

export type LanguageChoice = {
  locale: Locale;
  /** The language's name in that language, e.g. 繁體中文. */
  label: string;
  /** This same page in that language. Relative, so it survives any origin. */
  href: string;
  active: boolean;
};

/**
 * The `?lang=` switcher, as links.
 *
 * Until now the locale could only be chosen by the browser's Accept-Language header,
 * which means a reader whose browser is in English had no way to read these pages in
 * their own language — the machinery was there and unreachable.
 *
 * Links rather than a `<select>` and a cookie: these pages carry no session and no
 * client JavaScript at all, so a link that reloads with a different query is the whole
 * feature. It also keeps the choice shareable and back-button-correct.
 *
 * Every other query parameter is preserved, which matters because the only way to reach
 * these pages is with a `?t=` token — dropping it would turn the switcher into a way to
 * break your own unsubscribe link.
 */
export function languageChoices(
  request: Parameters<typeof localeFromRequest>[0],
  current: Locale,
): LanguageChoice[] {
  const url = requestUrl(request);

  return LOCALES.map((locale) => {
    const target = new URL(url);
    target.searchParams.set("lang", locale);
    return {
      locale,
      label: LOCALE_LABELS[locale],
      href: `${target.pathname}${target.search}`,
      active: locale === current,
    };
  });
}

function requestUrl(request: Parameters<typeof localeFromRequest>[0]): URL {
  if (request.url) {
    try {
      return new URL(request.url);
    } catch {
      // Falls through to the placeholder below.
    }
  }
  // Origin is irrelevant — only pathname and search are read back out.
  const url = new URL("http://localhost/");
  if (request.nextUrl) {
    for (const [key, value] of request.nextUrl.searchParams) {
      url.searchParams.set(key, value);
    }
  }
  return url;
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
