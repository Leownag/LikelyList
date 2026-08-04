import { DEFAULT_LOCALE, type Locale } from "../locales";
import en from "./en.json";
import zhHant from "./zh-Hant.json";

/**
 * Message catalogue: one JSON file per locale, plus this loader.
 *
 * One file per locale is what translation tooling and human reviewers expect — a diff on
 * `zh-Hant.json` shows exactly which strings changed, where a diff on a single TypeScript
 * file interleaves two languages and a code review has to read both to check one.
 * next-intl, i18next and Lingui all use this shape.
 *
 * The type guarantee survives the split, which is the part worth being careful about:
 * `MessageKey` is derived from en.json, so `const zh: Messages` below fails to compile if
 * zh-Hant.json is missing a key or has one English no longer has. That is the same check
 * the single-file version gave, and it is the reason these are typed imports rather than
 * `readFileSync` + `JSON.parse`.
 *
 * Keys are namespaced by the surface they appear on — `overview.*`, `settings.*`,
 * `landing.*` — because JSON has no comments to group them with. Sorting the file by key
 * therefore sorts it by screen. A string used on two screens belongs under `common.*`: a
 * translation that has to fit two contexts is where wording starts to go wrong.
 *
 * `{placeholders}` are filled by `t(key, values)`. Named rather than positional, so a
 * translation can reorder them — Chinese puts a count and its noun the other way round
 * from English more often than not.
 *
 * Not in here, deliberately:
 *   - /privacy. A translated privacy policy is a legal document in a second language, and
 *     which version governs is not a decision this file should quietly make.
 *   - Search copy for /explore. Its title and description are written for search terms.
 */

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const CATALOGUES: Record<Locale, Messages> = {
  en,
  // Typed on the way in: a missing or stray key in the JSON is a compile error here.
  "zh-Hant": zhHant satisfies Messages,
};

export type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

/**
 * A lookup function for one locale.
 *
 * Falls back to English per key rather than per locale, so a single missing string
 * degrades to English instead of dropping the reader out of their language entirely.
 */
export function translator(locale: Locale): Translate {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];

  return (key, values) => {
    const template = catalogue[key] ?? CATALOGUES[DEFAULT_LOCALE][key] ?? key;
    if (!values) return template;

    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? String(values[name]) : whole,
    );
  };
}

export function getMessages(locale: Locale): Messages {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
}
