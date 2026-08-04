import { test } from "node:test";
import assert from "node:assert/strict";

import { safeSendInstant } from "./plan";

const NOW = new Date("2026-08-07T08:00:00Z");

test("a normal subscriber gets their own local morning", () => {
  const warnings: string[] = [];
  const at = safeSendInstant(
    NOW,
    { id: "u1", timezone: "America/New_York", digest_send_hour: 8 },
    warnings,
  );
  assert.equal(at, "2026-08-07T12:00:00.000Z");
  assert.deepEqual(warnings, []);
});

test("an unusable timezone degrades to UTC instead of throwing", () => {
  // The failure this guards: the planner computes send_after for the entire
  // audience in one pass, and Intl throws a RangeError on an unknown zone — so
  // before this guard one junk row aborted the run and nobody got an email.
  for (const timezone of ["garbage", "", "Etc/Nonsense", "America/Nowhere"]) {
    const warnings: string[] = [];
    const at = safeSendInstant(
      NOW,
      { id: "u2", timezone, digest_send_hour: 8 },
      warnings,
    );
    assert.equal(at, "2026-08-07T08:00:00.000Z", `timezone ${JSON.stringify(timezone)}`);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unusable timezone/);
  }
});

test("a nonsense send hour cannot make the fallback throw either", () => {
  const warnings: string[] = [];
  const at = safeSendInstant(
    NOW,
    { id: "u3", timezone: "garbage", digest_send_hour: 99 },
    warnings,
  );
  // Falls back to 08:00 UTC rather than producing an Invalid Date.
  assert.equal(at, "2026-08-07T08:00:00.000Z");
  assert.ok(!Number.isNaN(new Date(at).getTime()));
});

test("one bad subscriber does not affect the others in the same pass", () => {
  const warnings: string[] = [];
  const subscribers = [
    { id: "good-1", timezone: "America/New_York", digest_send_hour: 8 },
    { id: "bad", timezone: "not-a-zone", digest_send_hour: 8 },
    { id: "good-2", timezone: "Asia/Taipei", digest_send_hour: 8 },
  ];

  const results = subscribers.map((s) => safeSendInstant(NOW, s, warnings));

  assert.equal(results.length, 3);
  assert.equal(results[0], "2026-08-07T12:00:00.000Z");
  assert.equal(results[2], "2026-08-07T00:00:00.000Z");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^bad:/);
});
