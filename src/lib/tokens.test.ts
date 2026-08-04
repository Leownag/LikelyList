import { test } from "node:test";
import assert from "node:assert/strict";

import { signToken, verifyToken } from "./tokens";

const SECRET = "test-secret-do-not-use";
const USER = "11111111-2222-3333-4444-555555555555";

test("a signed token round-trips its claims", async () => {
  const token = await signToken(SECRET, "unsubscribe", USER);
  const verified = await verifyToken(SECRET, "unsubscribe", token);
  assert.deepEqual(verified, { userId: USER, extra: "" });
});

test("extra claims survive the round trip", async () => {
  const token = await signToken(SECRET, "preview", USER, "run-abc");
  const verified = await verifyToken(SECRET, "preview", token);
  assert.equal(verified?.extra, "run-abc");
});

test("a token is bound to its purpose", async () => {
  // Otherwise an unsubscribe link could be replayed to read someone's digest.
  const token = await signToken(SECRET, "unsubscribe", USER);
  assert.equal(await verifyToken(SECRET, "preview", token), null);
});

test("a token signed with another secret is rejected", async () => {
  const token = await signToken("other-secret", "unsubscribe", USER);
  assert.equal(await verifyToken(SECRET, "unsubscribe", token), null);
});

test("tampering with the payload invalidates the token", async () => {
  const token = await signToken(SECRET, "unsubscribe", USER);
  const [payload, signature] = token.split(".");

  // Re-encode a payload naming a different user, keeping the original signature.
  const forgedPayload = btoa("unsubscribe:99999999-0000-0000-0000-000000000000:")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(
    await verifyToken(SECRET, "unsubscribe", `${forgedPayload}.${signature}`),
    null,
  );

  // And flipping the signature fails too.
  assert.equal(
    await verifyToken(SECRET, "unsubscribe", `${payload}.${signature.slice(0, -2)}xy`),
    null,
  );
});

test("malformed input is rejected rather than throwing", async () => {
  for (const bad of ["", "no-separator", ".", "a.b.c.", "!!!.!!!"]) {
    assert.equal(await verifyToken(SECRET, "unsubscribe", bad), null);
  }
  assert.equal(await verifyToken(SECRET, "unsubscribe", null), null);
  assert.equal(await verifyToken("", "unsubscribe", "anything"), null);
});

test("signing without a secret fails loudly", async () => {
  await assert.rejects(() => signToken("", "unsubscribe", USER), /HMAC_SECRET/);
});
