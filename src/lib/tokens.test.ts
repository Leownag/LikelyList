import { test } from "node:test";
import assert from "node:assert/strict";

import { PREVIEW_TOKEN_MAX_AGE_MS, signToken, verifyToken } from "./tokens";

const SECRET = "test-secret-do-not-use";
const USER = "11111111-2222-3333-4444-555555555555";
const DAY = 24 * 60 * 60 * 1000;

test("a signed token round-trips its claims", async () => {
  const token = await signToken(SECRET, "unsubscribe", USER, "", 1_000);
  const verified = await verifyToken(SECRET, "unsubscribe", token);
  assert.deepEqual(verified, { userId: USER, extra: "", issuedAt: 1_000 });
});

test("extra claims survive, including ones containing colons", async () => {
  const token = await signToken(SECRET, "preview", USER, "run:abc:1");
  const verified = await verifyToken(SECRET, "preview", token);
  assert.equal(verified?.extra, "run:abc:1");
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

  const forgedPayload = btoa(
    `unsubscribe:99999999-0000-0000-0000-000000000000:${Date.now()}:`,
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(
    await verifyToken(SECRET, "unsubscribe", `${forgedPayload}.${signature}`),
    null,
  );

  assert.equal(
    await verifyToken(SECRET, "unsubscribe", `${payload}.${signature.slice(0, -2)}xy`),
    null,
  );
});

test("the issue time is signed, so it cannot be pushed forward", async () => {
  const now = 10 * DAY;
  const old = await signToken(SECRET, "preview", USER, "", now - 8 * DAY);
  const [payload, signature] = old.split(".");

  // Re-encode the same payload with a fresh timestamp but the original
  // signature — the whole point of putting issuedAt inside the signed region.
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  const refreshed = btoa(decoded.replace(String(now - 8 * DAY), String(now)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  assert.equal(
    await verifyToken(SECRET, "preview", `${refreshed}.${signature}`, {
      maxAgeMs: PREVIEW_TOKEN_MAX_AGE_MS,
      now,
    }),
    null,
  );
});

test("preview tokens expire", async () => {
  const now = 30 * DAY;

  const fresh = await signToken(SECRET, "preview", USER, "", now - 1 * DAY);
  assert.ok(
    await verifyToken(SECRET, "preview", fresh, {
      maxAgeMs: PREVIEW_TOKEN_MAX_AGE_MS,
      now,
    }),
  );

  const stale = await signToken(SECRET, "preview", USER, "", now - 8 * DAY);
  assert.equal(
    await verifyToken(SECRET, "preview", stale, {
      maxAgeMs: PREVIEW_TOKEN_MAX_AGE_MS,
      now,
    }),
    null,
  );
});

test("unsubscribe tokens never expire", async () => {
  // A recipient must always be able to get out, including from an email they
  // find a year later. No maxAgeMs is passed at that call site.
  const ancient = await signToken(SECRET, "unsubscribe", USER, "", 0);
  const verified = await verifyToken(SECRET, "unsubscribe", ancient, {
    now: 400 * DAY,
  });
  assert.equal(verified?.userId, USER);
});

test("a token issued in the future is rejected beyond the skew allowance", async () => {
  const now = 10 * DAY;
  const nearFuture = await signToken(SECRET, "preview", USER, "", now + 30_000);
  assert.ok(
    await verifyToken(SECRET, "preview", nearFuture, {
      maxAgeMs: PREVIEW_TOKEN_MAX_AGE_MS,
      now,
    }),
    "30s of clock skew should be tolerated",
  );

  const farFuture = await signToken(SECRET, "preview", USER, "", now + 10 * DAY);
  assert.equal(
    await verifyToken(SECRET, "preview", farFuture, {
      maxAgeMs: PREVIEW_TOKEN_MAX_AGE_MS,
      now,
    }),
    null,
  );
});

test("a non-numeric issue time is rejected", async () => {
  const payload = btoa(`preview:${USER}:not-a-number:`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  // Signed correctly, but structurally invalid.
  const signed = await signToken(SECRET, "preview", USER);
  const signature = signed.split(".")[1];
  assert.equal(await verifyToken(SECRET, "preview", `${payload}.${signature}`), null);
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
