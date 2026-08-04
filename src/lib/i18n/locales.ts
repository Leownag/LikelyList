/**
 * Supported locales.
 *
 * `zh-Hant` rather than `zh-TW`: the distinction that matters here is the script,
 * not the region, and matching on script means a `zh-HK` or `zh-MO` reader also
 * gets Traditional characters instead of falling back to English.
 */
export const LOCALES = ["en", "es", "fr", "zh-Hant"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Shown in a language switcher, each in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  "zh-Hant": "繁體中文",
};

/** The `lang` attribute value to put on `<html>`. */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: "en",
  es: "es",
  fr: "fr",
  "zh-Hant": "zh-Hant",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return Boolean(value) && (LOCALES as readonly string[]).includes(value as string);
}

/**
 * Picks the best locale from an `Accept-Language` header.
 *
 * Parsed by hand rather than with `Intl.LocaleMatcher` (not available) or a
 * library: the header is a short, well-specified list and the matching rules we
 * need are narrow.
 *
 * Matching is deliberately layered:
 *   1. an exact tag             — `zh-Hant`
 *   2. the script subtag        — `zh-Hant-HK` and `zh-HK` both mean Traditional
 *   3. the base language        — `es-MX` -> `es`
 * `zh` on its own is left to fall through to English rather than guessed, because
 * bare `zh` is ambiguous between scripts and guessing wrong is worse than not
 * translating.
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

    const base = lower.split("-")[0];
    if (base === "es") return "es";
    if (base === "fr") return "fr";
    if (base === "en") return "en";
  }

  return DEFAULT_LOCALE;
}
