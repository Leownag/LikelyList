import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_HTML_LANG,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "./locales";
import { LOCALE_COOKIE } from "./cookie";
import { translator, type Translate } from "./messages";

/**
 * The locale for a server-rendered page.
 *
 * Order: an explicit choice, then the browser's own setting, then English. The cookie
 * wins because it is the only one of the three the reader set on purpose.
 *
 * Reading cookies makes a page dynamic. That costs nothing here — every page that calls
 * this already reads a session or a search param — but it is the reason /robots.txt and
 * /sitemap.xml do not call it.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  const header = (await headers()).get("accept-language");
  return localeFromAcceptLanguage(header);
}

export type ServerI18n = {
  locale: Locale;
  htmlLang: string;
  t: Translate;
};

export async function getI18n(): Promise<ServerI18n> {
  const locale = await getLocale();
  return {
    locale,
    htmlLang: LOCALE_HTML_LANG[locale] ?? LOCALE_HTML_LANG[DEFAULT_LOCALE],
    t: translator(locale),
  };
}

/** Shorthand for a page that only needs to translate. */
export async function getT(): Promise<Translate> {
  return translator(await getLocale());
}
