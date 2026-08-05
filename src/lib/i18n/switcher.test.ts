import assert from "node:assert/strict";
import test from "node:test";
import { languageChoices, i18nFromRequest } from "./request";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_LABELS } from "./locales";

/** The shape both routes hand in: a NextRequest, of which only these parts are read. */
function request(url: string) {
  return {
    url,
    headers: { get: () => null },
    nextUrl: { searchParams: new URL(url).searchParams },
  };
}

test("switching language keeps the token that is the only way to reach the page", () => {
  const choices = languageChoices(
    request("https://likelylist.tech/unsubscribe?t=abc.def"),
    "en",
  );

  for (const choice of choices) {
    assert.match(choice.href, /^\/unsubscribe\?/);
    assert.ok(
      choice.href.includes("t=abc.def"),
      `${choice.locale} dropped the token: ${choice.href}`,
    );
  }
});

test("every served locale is offered once, with exactly one marked current", () => {
  const choices = languageChoices(
    request("https://likelylist.tech/unsubscribe"),
    DEFAULT_LOCALE,
  );

  assert.deepEqual(
    choices.map((choice) => choice.locale),
    [...ENABLED_LOCALES],
  );
  assert.deepEqual(
    choices.filter((choice) => choice.active).map((choice) => choice.locale),
    [DEFAULT_LOCALE],
  );
  // Each label in its own language, so it is readable to the person who needs it.
  assert.deepEqual(
    choices.map((choice) => choice.label),
    ENABLED_LOCALES.map((locale) => LOCALE_LABELS[locale]),
  );
});

test("an existing lang is replaced rather than appended", () => {
  const choices = languageChoices(
    request("https://likelylist.tech/subscribe/confirm?t=x&lang=zh-Hant"),
    "zh-Hant",
  );
  const english = choices.find((choice) => choice.locale === "en")!;

  assert.equal(english.href.match(/lang=/g)?.length, 1);
  assert.ok(english.href.includes("lang=en"));
});

/**
 * The guard on the English-only decision.
 *
 * A catalogue that still exists is easy to serve by accident: zh-Hant.json is complete and
 * `isLocale("zh-Hant")` is still true, so forgetting one `isEnabledLocale` gate would ship
 * Chinese to anyone whose browser asks for it. This asserts both routes in — the header and
 * an explicit `?lang=` — because they are resolved by separate branches.
 *
 * Flip this back to the `?lang`-wins assertion when ENABLED_LOCALES grows again.
 */
test("only English is served, whatever the browser or the URL asks for", () => {
  const zhHeader = { get: (name: string) => (name === "accept-language" ? "zh-TW,zh;q=0.9" : null) };

  assert.equal(i18nFromRequest({ ...request("https://x/unsubscribe"), headers: zhHeader }).locale, "en");
  assert.equal(
    i18nFromRequest({
      ...request("https://x/unsubscribe?lang=zh-Hant"),
      headers: zhHeader,
    }).locale,
    "en",
  );
  assert.equal(languageChoices(request("https://x/unsubscribe"), "en").length, 1);
});
