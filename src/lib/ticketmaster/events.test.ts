import { test } from "node:test";
import assert from "node:assert/strict";

import { toCachedEvent } from "./events";
import type { TmEvent } from "./types";

const EXPIRES = new Date("2026-08-09T00:00:00Z");
/** A grid cell key, which is what events are keyed by since migration 0014. */
const CELL = "42.25,-71";

function event(overrides: Partial<TmEvent> = {}): TmEvent {
  return {
    id: "evt-1",
    name: "Turnstile",
    dates: { start: { localDate: "2026-11-15", localTime: "20:00:00" } },
    ...overrides,
  };
}

test("a public onsale is captured as an absolute instant", () => {
  // Not a venue wall clock, unlike local_date/local_time: a ticket drop is one
  // moment everybody races at once, and the email renders it per subscriber.
  const row = toCachedEvent(
    event({ sales: { public: { startDateTime: "2026-08-08T14:00:00Z" } } }),
    CELL,
    EXPIRES,
  );

  assert.equal(row.onsale_start, "2026-08-08T14:00:00.000Z");
  // The event's own date is untouched and still a local date.
  assert.equal(row.local_date, "2026-11-15");
});

test("an onsale that has no usable date is null rather than invalid", () => {
  // Every one of these means the same thing to the digest — nothing to announce.
  // The unparseable case matters most: a bad string would reach Postgres as a
  // timestamptz and fail the whole city's cache upsert, not just this row.
  const cases: Partial<TmEvent>[] = [
    {},
    { sales: {} },
    { sales: { public: {} } },
    { sales: { public: { startDateTime: "2026-08-08T14:00:00Z", startTBD: true } } },
    { sales: { public: { startDateTime: "2026-08-08T14:00:00Z", startTBA: true } } },
    { sales: { public: { startDateTime: "sometime in August" } } },
    // Ticketmaster's "on sale since forever" sentinel. Measured at 8 of 100 events
    // on one Boston week, so this is the common case rather than an edge one.
    { sales: { public: { startDateTime: "1900-01-01T06:00:00Z" } } },
  ];

  for (const overrides of cases) {
    const row = toCachedEvent(event(overrides), CELL, EXPIRES);
    assert.equal(
      row.onsale_start,
      null,
      `expected null for ${JSON.stringify(overrides)}`,
    );
  }
});
