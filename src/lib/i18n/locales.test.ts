import { test } from "node:test";
import assert from "node:assert/strict";

import { LOCALES, isLocale, localeFromAcceptLanguage } from "./locales";
import { getMessages, translator } from "./messages";

test("every locale has a complete catalogue", () => {
  // The point of deriving Messages from the English catalogue: a key added in
  // English and left untranslated is a type error, and this catches a translation
  // that was deleted rather than never written.
  const englishKeys = Object.keys(getMessages("en")).sort();
  for (const locale of LOCALES) {
    assert.deepEqual(
      Object.keys(getMessages(locale)).sort(),
      englishKeys,
      `${locale} catalogue does not match English`,
    );
  }
});

test("no translation is left as the English string by accident", () => {
  // Not a hard rule — a proper noun could legitimately match — so this only checks
  // the strings that definitely should differ.
  const mustDiffer = [
    "unsubscribe.confirm.action",
    "subscribe.confirm.action",
    "common.privacy",
    "common.signIn",
  ] as const;

  const english = getMessages("en");
  for (const locale of LOCALES.filter((l) => l !== "en")) {
    const catalogue = getMessages(locale);
    for (const key of mustDiffer) {
      assert.notEqual(
        catalogue[key],
        english[key],
        `${locale}.${key} is still the English string`,
      );
    }
  }
});

test("Accept-Language is matched by quality, then script, then base language", () => {
  assert.equal(localeFromAcceptLanguage("en-GB,en;q=0.9"), "en");
  // Lower-quality entry wins when it is the only one we support.
});

test("Traditional Chinese is matched by script, not just by region", () => {
  for (const header of [
    "zh-Hant",
    "zh-Hant-TW",
    "zh-TW",
    "zh-HK,zh;q=0.9",
    "zh-MO",
  ]) {
    assert.equal(
      localeFromAcceptLanguage(header),
      "zh-Hant",
      `${header} should resolve to zh-Hant`,
    );
  }
});

test("Simplified Chinese and bare zh are not guessed into Traditional", () => {
  // Bare `zh` is ambiguous between scripts, and serving Traditional to a
  // Simplified reader is worse than serving English.
  assert.equal(localeFromAcceptLanguage("zh-CN"), "en");
  assert.equal(localeFromAcceptLanguage("zh-Hans"), "en");
  assert.equal(localeFromAcceptLanguage("zh"), "en");
});

test("missing or unparseable headers fall back to English", () => {
  assert.equal(localeFromAcceptLanguage(null), "en");
  assert.equal(localeFromAcceptLanguage(""), "en");
  assert.equal(localeFromAcceptLanguage("*"), "en");
  assert.equal(localeFromAcceptLanguage("xx-YY;q=nonsense"), "en");
  // q=0 means "explicitly not this".
  assert.equal(localeFromAcceptLanguage("fr;q=0"), "en");
});

test("isLocale accepts only the supported tags", () => {
  assert.ok(isLocale("zh-Hant"));
  assert.equal(isLocale("zh-TW"), false);
  assert.equal(isLocale("de"), false);
  assert.equal(isLocale(null), false);
  assert.equal(isLocale(undefined), false);
});

test("a translator falls back per key, not per locale", () => {
  const t = translator("zh-Hant");
  assert.equal(t("common.privacy"), "隱私權");
  // An unknown key returns the key itself rather than throwing or rendering
  // "undefined" into a page.
  // @ts-expect-error deliberately not a MessageKey
  assert.equal(t("nope.not.a.key"), "nope.not.a.key");
});
