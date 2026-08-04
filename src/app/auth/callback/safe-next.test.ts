import { test } from "node:test";
import assert from "node:assert/strict";

// The validator moved out of route.ts into lib so it could be tested without
// pulling a route handler (and its Supabase imports) into the test. This file
// keeps the adversarial corpus for the post-login redirect specifically; the
// function's general contract is covered in src/lib/safe-redirect.test.ts.
import { safeRedirectPath as safeNext } from "@/lib/safe-redirect";

const ORIGIN = "https://likelylist.tech";

/**
 * Regression tests for the post-login redirect.
 *
 * The first version checked the string ("starts with / but not //"), which is the
 * common shortcut and is wrong: the WHATWG URL parser treats a backslash as a path
 * separator in special schemes, so several of the cases below slipped through and
 * resolved to an attacker's origin. That is an open redirect on a URL that
 * genuinely completes a real sign-in, which is the most convincing shape a
 * phishing link can take.
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
  // Includes the shapes that exploit parser normalisation rather than the leading
  // characters: the URL parser strips tabs and newlines before parsing, and
  // percent-encoded slashes survive as path rather than becoming an authority.
  const attempts = [
    "/app",
    "//evil.com",
    "/\\evil.com",
    "/app/../../etc",
    "/%2f%2fevil.com",
    "/\t//evil.com",
    "/\n//evil.com",
    "/\r//evil.com",
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
