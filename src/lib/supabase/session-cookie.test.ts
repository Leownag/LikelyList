import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenIsFresh, REFRESH_MARGIN_MS } from "./session-cookie";
import { stringToBase64URL } from "@supabase/ssr";

const NOW = 1_700_000_000_000;

/** The cookie @supabase/ssr writes, optionally split the way it splits large ones. */
function sessionCookies(expiresAtMs: number, chunks = 1) {
  const value =
    "base64-" +
    stringToBase64URL(
      JSON.stringify({
        access_token: "a".repeat(200),
        refresh_token: "r",
        expires_at: Math.floor(expiresAtMs / 1000),
      }),
    );

  if (chunks === 1) return [{ name: "sb-abcdef-auth-token", value }];

  const size = Math.ceil(value.length / chunks);
  return Array.from({ length: chunks }, (_, i) => ({
    name: `sb-abcdef-auth-token.${i}`,
    value: value.slice(i * size, (i + 1) * size),
  }));
}

test("a token well inside its lifetime is safe to read", () => {
  assert.equal(accessTokenIsFresh(sessionCookies(NOW + 3_600_000), NOW), true);
});

test("a token inside auth-js's refresh margin is not", () => {
  // This is the whole point: auth-js would rotate here, and a server component
  // cannot keep the rotated token.
  assert.equal(accessTokenIsFresh(sessionCookies(NOW + REFRESH_MARGIN_MS - 1), NOW), false);
  assert.equal(accessTokenIsFresh(sessionCookies(NOW - 1), NOW), false);
});

test("chunked cookies are reassembled in numeric order", () => {
  const chunked = sessionCookies(NOW + 3_600_000, 12);
  assert.equal(accessTokenIsFresh(chunked, NOW), true);
  // Shuffled the way a cookie jar may well hand them over, and with `.10` sorting
  // before `.2` under a string comparison.
  assert.equal(accessTokenIsFresh([...chunked].reverse(), NOW), true);
});

test("no session, or a mangled one, reads as stale rather than throwing", () => {
  assert.equal(accessTokenIsFresh([], NOW), false);
  assert.equal(accessTokenIsFresh([{ name: "likelylist_lang", value: "en" }], NOW), false);
  assert.equal(
    accessTokenIsFresh([{ name: "sb-abcdef-auth-token", value: "base64-!!" }], NOW),
    false,
  );
});
