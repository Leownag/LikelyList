/**
 * Supported locales.
 *
 * Two, deliberately. Spanish and French were carried for the four email-landing pages
 * and nowhere else, and a language that covers 21 strings out of the app's several
 * hundred is worse than no offer at all — it promises a translated product and delivers
 * one screen of it. English and Traditional Chinese are the two this is maintained in.
 *
 * `zh-Hant` rather than `zh-TW`: the distinction that matters here is the script, not
 * the region, and matching on script means a `zh-HK` or `zh-MO` reader also gets
 * Traditional characters instead of falling back to English.
 */
export const LOCALES = ["en", "zh-Hant"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * The locales actually served.
 *
 * zh-Hant is written, maintained and kept in the catalogue — it is switched off, not
 * removed, because a half-served language is worse than one language done properly.
 * Re-enabling is this one line: `= LOCALES`.
 *
 * Deliberately separate from LOCALES rather than a narrowing of it: narrowing `Locale`
 * makes every catalogue and label record a type error, which is a large diff to pay for
 * a temporary decision.
 */
export const ENABLED_LOCALES: readonly Locale[] = [DEFAULT_LOCALE];

/** Shown in the language switcher, each in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-Hant": "繁體中文",
};

/** Short form, for a switcher that has to fit in a header. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  "zh-Hant": "中文",
};

/** The `lang` attribute value to put on `<html>`. */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: "en",
  "zh-Hant": "zh-Hant",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return Boolean(value) && (LOCALES as readonly string[]).includes(value as string);
}

/**
 * Is this a locale we currently serve?
 *
 * The gate every request goes through. `isLocale` stays a truthful answer to "is this a
 * tag we have a catalogue for", which is what the translation tooling and tests need.
 */
export function isEnabledLocale(value: string | null | undefined): value is Locale {
  return isLocale(value) && ENABLED_LOCALES.includes(value);
}

/**
 * Picks the best locale from an `Accept-Language` header.
 *
 * Parsed by hand rather than with `Intl.LocaleMatcher` (not available) or a library: the
 * header is a short, well-specified list and the matching rules we need are narrow.
 *
 * Matching is deliberately layered:
 *   1. an exact tag             — `zh-Hant`
 *   2. the script subtag        — `zh-Hant-HK` and `zh-HK` both mean Traditional
 *   3. the base language        — `en-GB` -> `en`
 * `zh` on its own is left to fall through to English rather than guessed, because bare
 * `zh` is ambiguous between scripts and guessing wrong is worse than not translating.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const lower = tag.toLowerCase();

    if (isLocale(tag)) return tag;
    if (lower === "zh-hant") return "zh-Hant";

    // Traditional-script Chinese regions, and any explicit Hant script subtag.
    if (
      lower.startsWith("zh-hant") ||
      lower === "zh-tw" ||
      lower === "zh-hk" ||
      lower === "zh-mo"
    ) {
      return "zh-Hant";
    }

    if (lower.split("-")[0] === "en") return "en";
  }

  return DEFAULT_LOCALE;
}
