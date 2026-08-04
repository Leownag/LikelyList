import { test } from "node:test";
import assert from "node:assert/strict";

import { safeNext } from "./route";

const ORIGIN = "https://likelylist.tech";

/**
 * Regression tests for the post-login redirect.
 *
 * The first version of safeNext checked the string ("starts with / but not //"),
 * which is the common shortcut and is wrong: the WHATWG URL parser treats a
 * backslash as a path separator in special schemes, so several of the cases below
 * slipped through and resolved to an attacker's origin.
 */

test("ordinary in-app paths pass through", () => {
  assert.equal(safeNext("/app", ORIGIN), "/app");
  assert.equal(safeNext("/app/feeds", ORIGIN), "/app/feeds");
  assert.equal(safeNext("/app?tab=cities", ORIGIN), "/app?tab=cities");
  assert.equal(safeNext("/app#section", ORIGIN), "/app#section");
});

test("absent or non-relative values fall back", () => {
  assert.equal(safeNext(null, ORIGIN), "/app");
  assert.equal(safeNext("", ORIGIN), "/app");
  assert.equal(safeNext("app", ORIGIN), "/app");
  assert.equal(safeNext("https://evil.com/", ORIGIN), "/app");
  assert.equal(safeNext("javascript:alert(1)", ORIGIN), "/app");
});

test("protocol-relative and backslash off-origin redirects are rejected", () => {
  // These are the ones a naive string check misses. Each resolves to
  // https://evil.com/ under the URL parser.
  for (const attempt of [
    "//evil.com",
    "/\\evil.com",
    "/\\\\evil.com",
    "/\\/evil.com",
    "//evil.com/app",
  ]) {
    const result = safeNext(attempt, ORIGIN);
    assert.equal(result, "/app", `${JSON.stringify(attempt)} must not escape`);
    // Belt and braces: whatever comes back must stay on our origin.
    assert.equal(new URL(result, ORIGIN).origin, ORIGIN);
  }
});

test("whatever is returned always resolves back to our own origin", () => {
  const attempts = [
    "/app",
    "//evil.com",
    "/\\evil.com",
    "/app/../../etc",
    "/%2f%2fevil.com",
    "/\t//evil.com",
    "/\n//evil.com",
  ];
  for (const attempt of attempts) {
    const result = safeNext(attempt, ORIGIN);
    assert.equal(
      new URL(result, ORIGIN).origin,
      ORIGIN,
      `${JSON.stringify(attempt)} resolved off-origin`,
    );
  }
});
