import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeByEventId, safeSendInstant } from "./plan";
import type { TmEvent } from "@/lib/ticketmaster/types";

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

test("the this-week and on-sale queries collapse to one row per event", () => {
  // The failure this guards: events_cache is keyed on (city_id, tm_event_id), and
  // the two per-city queries overlap whenever a show goes on sale days before it
  // happens. Two rows with the same key in one upsert makes Postgres reject the
  // whole statement — "ON CONFLICT DO UPDATE command cannot affect row a second
  // time" — which would lose that city's entire cache, not just the duplicate.
  const event = (id: string, name: string): TmEvent => ({ id, name });

  const thisWeek = [event("A", "Turnstile"), event("B", "Wednesday")];
  const onsale = [event("B", "Wednesday"), event("C", "black midi")];

  const merged = dedupeByEventId([...thisWeek, ...onsale]);

  assert.deepEqual(
    merged.map((e) => e.id),
    ["A", "B", "C"],
  );
  assert.equal(new Set(merged.map((e) => e.id)).size, merged.length);
});
