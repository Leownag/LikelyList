import { test } from "node:test";
import assert from "node:assert/strict";

import { digestIdempotencyKey } from "./send";
import { digestLinkIssuedAt } from "./build";
import { PREVIEW_TOKEN_MAX_AGE_MS, signToken, verifyToken } from "@/lib/tokens";

const SECRET = "test-secret-do-not-use";
const RUN = "11111111-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Resend's ceiling. A key over this is rejected outright. */
const MAX_KEY_LENGTH = 256;

test("the key is stable across attempts and unique per subscriber", () => {
  // The whole point: attempt two of a job must present attempt one's key, or
  // Resend has no way to recognise the repeat and sends a second email.
  assert.equal(
    digestIdempotencyKey(RUN, USER),
    digestIdempotencyKey(RUN, USER),
  );

  const otherRun = digestIdempotencyKey(
    "99999999-2222-3333-4444-555555555555",
    USER,
  );
  const otherUser = digestIdempotencyKey(
    RUN,
    "99999999-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.notEqual(digestIdempotencyKey(RUN, USER), otherRun);
  assert.notEqual(digestIdempotencyKey(RUN, USER), otherUser);

  assert.ok(digestIdempotencyKey(RUN, USER).length <= MAX_KEY_LENGTH);
});

test("a run's links are byte-identical on every rebuild", async () => {
  // Resend compares the body as well as the key, and rejects a reused key whose
  // payload moved. Tokens are the only part of the email carrying a timestamp,
  // so if they were minted per render every retry would 409 instead of being
  // recognised as a repeat — the job would burn all three attempts and land in
  // `failed` having already emailed the reader once.
  const window = "2026-11-18";
  const now = Date.parse("2026-11-18T08:00:00Z");

  const first = await signToken(
    SECRET,
    "unsubscribe",
    USER,
    "",
    digestLinkIssuedAt(window, now),
  );
  const second = await signToken(
    SECRET,
    "unsubscribe",
    USER,
    "",
    // Five minutes later, the next drainer pass.
    digestLinkIssuedAt(window, now + 5 * 60_000),
  );

  assert.equal(first, second);
});

test("next week's run gets its own links", async () => {
  const now = Date.parse("2026-11-25T08:00:00Z");
  const thisWeek = digestLinkIssuedAt("2026-11-18", now);
  const nextWeek = digestLinkIssuedAt("2026-11-25", now);

  assert.notEqual(thisWeek, nextWeek);
  assert.notEqual(
    await signToken(SECRET, "unsubscribe", USER, "", thisWeek),
    await signToken(SECRET, "unsubscribe", USER, "", nextWeek),
  );
});

test("a window that has not started yet is stamped as now", () => {
  // The on-demand preview builds its window from the reader's local midnight,
  // which is still ahead of UTC for zones east of it. verifyToken treats a token
  // issued in the future as forged, so the anchor is clamped.
  const now = Date.parse("2026-11-17T21:00:00Z");
  assert.equal(digestLinkIssuedAt("2026-11-18", now), now);
});

test("anchoring the preview link on the window start still outlives the week", async () => {
  // Anchoring on the window start rather than the render instant moves a preview
  // link's expiry a few hours earlier, so this pins the thing that actually
  // matters: it is readable from the morning it arrives until the next digest
  // replaces it.
  const window = "2026-11-18";
  const sentAt = Date.parse("2026-11-18T08:00:00Z");
  const token = await signToken(
    SECRET,
    "preview",
    USER,
    "",
    digestLinkIssuedAt(window, sentAt),
  );

  const read = (now: number) =>
    verifyToken(SECRET, "preview", token, {
      maxAgeMs: PREVIEW_TOKEN_MAX_AGE_MS,
      now,
    });

  // Opened the moment it lands. A token stamped at window start must not read as
  // issued in the future.
  assert.ok(await read(sentAt));
  // Still readable the evening before next week's send.
  assert.ok(await read(Date.parse("2026-11-24T20:00:00Z")));
  // And gone once it is a week old.
  assert.equal(await read(Date.parse("2026-11-26T00:00:00Z")), null);
});
