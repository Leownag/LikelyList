import { test } from "node:test";
import assert from "node:assert/strict";

import {
  digestWindow,
  formatEventDate,
  formatEventTime,
  localDateString,
  localParts,
  nextWeekdayAt,
  sendInstantFor,
  timeZoneOffsetMs,
  zonedTimeToUtc,
} from "./time";

const HOUR = 60 * 60 * 1000;

test("timeZoneOffsetMs tracks US daylight saving", () => {
  // 2026-07-01 is EDT (UTC-4); 2026-01-01 is EST (UTC-5).
  assert.equal(
    timeZoneOffsetMs("America/New_York", new Date("2026-07-01T12:00:00Z")),
    -4 * HOUR,
  );
  assert.equal(
    timeZoneOffsetMs("America/New_York", new Date("2026-01-01T12:00:00Z")),
    -5 * HOUR,
  );
  // Taipei has no DST.
  assert.equal(
    timeZoneOffsetMs("Asia/Taipei", new Date("2026-07-01T12:00:00Z")),
    8 * HOUR,
  );
});

test("zonedTimeToUtc resolves a local wall clock to the right instant", () => {
  // 08:00 in Boston in August is 12:00 UTC (EDT)...
  assert.equal(
    zonedTimeToUtc("America/New_York", 2026, 8, 7, 8).toISOString(),
    "2026-08-07T12:00:00.000Z",
  );
  // ...and 13:00 UTC in January (EST). This one-hour difference is exactly why
  // the send time is computed per user instead of being baked into the cron.
  assert.equal(
    zonedTimeToUtc("America/New_York", 2026, 1, 9, 8).toISOString(),
    "2026-01-09T13:00:00.000Z",
  );
  assert.equal(
    zonedTimeToUtc("Asia/Taipei", 2026, 8, 7, 8).toISOString(),
    "2026-08-07T00:00:00.000Z",
  );
});

test("zonedTimeToUtc survives the spring-forward gap", () => {
  // 2026-03-08 02:30 does not exist in New York — the clock jumps 02:00 to
  // 03:00. The two-pass correction must still return a real instant rather than
  // looping or producing NaN.
  const resolved = zonedTimeToUtc("America/New_York", 2026, 3, 8, 2, 30);
  assert.ok(Number.isFinite(resolved.getTime()));
  // Whatever it lands on, reading it back must be a valid local time.
  const back = localParts("America/New_York", resolved);
  assert.equal(back.day, 8);
});

test("localParts and localDateString use the target zone, not the host", () => {
  // 03:00 UTC on the 8th is still the 7th in Los Angeles.
  const at = new Date("2026-08-08T03:00:00Z");
  assert.equal(localDateString("America/Los_Angeles", at), "2026-08-07");
  assert.equal(localDateString("UTC", at), "2026-08-08");

  const parts = localParts("Asia/Taipei", at);
  assert.equal(parts.day, 8);
  assert.equal(parts.hour, 11);
});

test("sendInstantFor gives each subscriber their own local morning", () => {
  const runDate = new Date("2026-08-07T08:00:00Z"); // the Friday cron firing

  assert.equal(
    sendInstantFor(runDate, "America/New_York", 8).toISOString(),
    "2026-08-07T12:00:00.000Z",
  );
  assert.equal(
    sendInstantFor(runDate, "America/Los_Angeles", 8).toISOString(),
    "2026-08-07T15:00:00.000Z",
  );
  // Taipei is already past 08:00 local when the cron fires, so this job is
  // immediately sendable rather than being held for a week.
  const taipei = sendInstantFor(runDate, "Asia/Taipei", 8);
  assert.equal(taipei.toISOString(), "2026-08-07T00:00:00.000Z");
  assert.ok(taipei.getTime() < runDate.getTime());
});

test("digestWindow covers seven days from local midnight today", () => {
  // Friday morning in Boston.
  const now = new Date("2026-08-07T12:30:00Z");
  const window = digestWindow(now, "America/New_York");

  assert.equal(window.startDate, "2026-08-07");
  assert.equal(window.endDate, "2026-08-13");
  assert.equal(window.end.getTime() - window.start.getTime(), 7 * 24 * HOUR);
  // Starting at local midnight means tonight's shows are still included.
  assert.ok(window.start.getTime() < now.getTime());
});

test("nextWeekdayAt skips to next week once the hour has passed", () => {
  // Friday 12:30 UTC = 08:30 in Boston, i.e. past an 08:00 send hour.
  const fridayMorning = new Date("2026-08-07T12:30:00Z");
  const next = nextWeekdayAt(fridayMorning, "America/New_York", 5, 8);
  assert.equal(next.toISOString(), "2026-08-14T12:00:00.000Z");

  // Earlier the same Friday, it should still be today.
  const fridayPreDawn = new Date("2026-08-07T09:00:00Z"); // 05:00 local
  assert.equal(
    nextWeekdayAt(fridayPreDawn, "America/New_York", 5, 8).toISOString(),
    "2026-08-07T12:00:00.000Z",
  );
});

test("event dates are formatted without being re-zoned", () => {
  // Ticketmaster's localDate is already local to the venue. Interpreting it in
  // any timezone would shift it a day for evening shows.
  assert.equal(formatEventDate("2026-08-07"), "Fri, Aug 7");
  assert.equal(formatEventDate("2026-12-31"), "Thu, Dec 31");
  assert.equal(formatEventDate("nonsense"), "nonsense");
});

test("event times are formatted, and absent times stay absent", () => {
  assert.equal(formatEventTime("20:00:00"), "8:00 PM");
  assert.equal(formatEventTime("09:30:00"), "9:30 AM");
  assert.equal(formatEventTime(null), null);
  assert.equal(formatEventTime("garbage"), null);
});
