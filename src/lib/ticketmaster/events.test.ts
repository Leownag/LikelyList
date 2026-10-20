import { test } from "node:test";
import assert from "node:assert/strict";

import { isSendableEvent, toCachedEvent } from "./events";
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

test("the cached row carries a zone, so a pin from the feed can become a real instant", () => {
  // The venue is where Ticketmaster usually puts it when `dates.timezone` is absent —
  // 12 of 85 events on one Boston week. Without this the digest stored a wall clock
  // with no anchor and "add to calendar" could only offer an all-day entry.
  const row = toCachedEvent(
    event({
      _embedded: { venues: [{ name: "Roadrunner-Boston", timezone: "America/New_York" }] },
    }),
    CELL,
    EXPIRES,
  );

  assert.equal(row.local_time, "20:00:00");
  assert.equal(row.timezone, "America/New_York");

  // Nothing anywhere: null, not a guess.
  assert.equal(toCachedEvent(event(), CELL, EXPIRES).timezone, null);
});

test("an event whose ticket sales have closed is not offered", () => {
  // The symptom this comes from: a listing whose "buy tickets" link opened a
  // Ticketmaster page reading TICKET SALES TERMINATED. The one action the
  // product offers was already unavailable.
  const now = new Date("2026-10-20T12:00:00Z");
  const base = {
    id: "x",
    name: "Show",
    dates: { start: { localDate: "2026-10-25" } },
  };

  assert.equal(
    isSendableEvent(
      { ...base, sales: { public: { endDateTime: "2026-10-19T00:00:00Z" } } },
      now,
    ),
    false,
  );
  assert.equal(
    isSendableEvent(
      { ...base, sales: { public: { endDateTime: "2026-10-24T00:00:00Z" } } },
      now,
    ),
    true,
  );
  // No sales block at all is the common case and says nothing either way.
  assert.equal(isSendableEvent(base, now), true);
  // Neither does a value that will not parse.
  assert.equal(
    isSendableEvent({ ...base, sales: { public: { endDateTime: "soon" } } }, now),
    true,
  );
});
