import { test } from "node:test";
import assert from "node:assert/strict";

import { safeRedirectPath } from "./safe-redirect";

/**
 * The function's general contract.
 *
 * The adversarial corpus for the post-login redirect — backslashes, tabs,
 * percent-encoded slashes and so on — lives beside its caller in
 * src/app/auth/callback/safe-next.test.ts. This file covers the parts of the
 * contract that are independent of that one call site, so the two do not restate
 * each other.
 */

const ORIGIN = "https://likelylist.tech";

test("a same-origin absolute URL is rejected rather than unwrapped", () => {
  // No legitimate caller passes an absolute URL, so it is refused instead of being
  // reduced to its path — one fewer shape to reason about.
  assert.equal(safeRedirectPath("https://likelylist.tech/app/settings", ORIGIN), "/app");
});

test("a subdomain of the site is a different origin", () => {
  assert.equal(safeRedirectPath("https://mail.likelylist.tech/x", ORIGIN), "/app");
});

test("the fallback is configurable", () => {
  assert.equal(safeRedirectPath("//evil.com", ORIGIN, "/"), "/");
  assert.equal(safeRedirectPath(null, ORIGIN, "/login"), "/login");
});

test("undefined is accepted as well as null", () => {
  assert.equal(safeRedirectPath(undefined, ORIGIN), "/app");
});

test("whitespace-only input falls back", () => {
  assert.equal(safeRedirectPath("   ", ORIGIN), "/app");
});

test("the port is part of the origin comparison", () => {
  const local = "http://localhost:3000";
  assert.equal(safeRedirectPath("/app", local), "/app");
  // A different port on the same host is a different origin.
  assert.equal(safeRedirectPath("//localhost:3001/app", local), "/app");
});

test("a malformed base origin does not throw", () => {
  // Guards against a misconfigured NEXT_PUBLIC_SITE_URL taking down sign-in.
  assert.equal(safeRedirectPath("/app", "not a url"), "/app");
});

test("query and fragment are preserved for a valid path", () => {
  assert.equal(
    safeRedirectPath("/app/subscriptions?x=1&y=2#z", ORIGIN),
    "/app/subscriptions?x=1&y=2#z",
  );
});
