import { test } from "node:test";
import assert from "node:assert/strict";

import sitemap from "./sitemap";
import robots from "./robots";
import { siteUrlFromEnv, localePath } from "@/lib/site-url";
import { ENABLED_LOCALES } from "@/lib/i18n/locales";

test("every sitemap URL is absolute and on our own origin", () => {
  const siteUrl = siteUrlFromEnv();
  for (const entry of sitemap()) {
    assert.ok(
      entry.url.startsWith(`${siteUrl}/`) || entry.url === siteUrl,
      `${entry.url} is not under ${siteUrl}`,
    );
  }
});

/**
 * The failure this exists to catch.
 *
 * Submitting a URL that robots.txt forbids is the one SEO mistake that reports itself
 * only as a Search Console warning weeks later — nothing breaks locally, and the page
 * simply never gets indexed. The two files are edited independently, so the agreement
 * between them has to be asserted rather than remembered.
 */
test("no sitemap URL is disallowed by robots.txt", () => {
  const siteUrl = siteUrlFromEnv();
  const rules = robots().rules;
  const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => {
    const value = rule.disallow ?? [];
    return Array.isArray(value) ? value : [value];
  });

  for (const entry of sitemap()) {
    const path = entry.url.slice(siteUrl.length) || "/";
    for (const prefix of disallowed) {
      assert.ok(
        !path.startsWith(prefix),
        `sitemap lists ${path}, which robots.txt disallows via "${prefix}"`,
      );
    }
  }
});

/**
 * hreflang has to be reciprocal or Google discards the whole cluster: every alternate must
 * name every other one, itself included. Declaring it in one place makes that easy to get
 * right and easy to break silently later, which is what this asserts.
 */
test("every locale of the landing page is listed and points at all the others", () => {
  const siteUrl = siteUrlFromEnv();
  const expected = new Set(ENABLED_LOCALES.map((l) => `${siteUrl}${localePath("/", l)}`));

  const landing = sitemap().filter((entry) => expected.has(entry.url));
  assert.equal(
    landing.length,
    ENABLED_LOCALES.length,
    "a served locale of / is missing from the sitemap",
  );

  for (const entry of landing) {
    const languages = entry.alternates?.languages ?? {};
    // x-default points at the English URL, so the set of hrefs is exactly the locale set.
    assert.deepEqual(
      new Set(Object.values(languages)),
      expected,
      `${entry.url} does not name every locale as an alternate`,
    );
    assert.ok(languages["x-default"], `${entry.url} has no x-default`);
  }
});
