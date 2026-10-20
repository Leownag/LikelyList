import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DIGEST_WEEKDAY,
  digestRunDate,
  digestWindow,
  formatEventDate,
  formatEventTime,
  formatInstantInZone,
  localDateString,
  localParts,
  morningSendHour,
  nextWeekdayAt,
  sendInstantFor,
  TIMEZONES,
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

// Tuesday 19:00 UTC: the weekly builder firing.
const RUN_START = new Date("2026-08-04T19:00:00Z");

test("sendInstantFor gives each subscriber their own local morning", () => {
  assert.equal(
    sendInstantFor(RUN_START, "America/New_York", 8).toISOString(),
    "2026-08-05T12:00:00.000Z",
  );
  assert.equal(
    sendInstantFor(RUN_START, "America/Los_Angeles", 8).toISOString(),
    "2026-08-05T15:00:00.000Z",
  );
  // Taipei is already into Wednesday when the builder fires, so its send is the
  // nearest one — two hours out, not a week.
  assert.equal(
    sendInstantFor(RUN_START, "Asia/Taipei", 8).toISOString(),
    "2026-08-05T00:00:00.000Z",
  );
});

test("every supported zone is sent on its own local Wednesday", () => {
  // The regression this pins down: the send day used to be whatever calendar day
  // the run instant fell on in the reader's zone, which is not the same day
  // everywhere. A Friday 08:00 UTC run was already Thursday evening in Honolulu,
  // so that reader got a "Friday" email on a Thursday — and nothing in the code
  // ever asserted the weekday, because the cron expression was the only place it
  // was written down.
  for (const zone of TIMEZONES) {
    for (const hour of [6, 8, 11]) {
      const at = sendInstantFor(RUN_START, zone, hour);
      const local = localParts(zone, at);
      assert.equal(local.weekday, DIGEST_WEEKDAY, `${zone} @ ${hour}`);
      assert.equal(local.hour, hour, `${zone} @ ${hour}`);
      assert.ok(at.getTime() >= RUN_START.getTime(), `${zone} @ ${hour}`);
    }
  }
});

test("a local morning already past when the run is built goes out at once", () => {
  // Zones far enough ahead of UTC can be past their send hour by the time the
  // builder fires. Waiting a week would be worse than being a few hours late,
  // and the cached listings the job reads expire long before then.
  const late = new Date("2026-08-04T22:00:00Z"); // 07:00 Wednesday in Tokyo
  assert.equal(sendInstantFor(late, "Asia/Tokyo", 6).getTime(), late.getTime());
});

test("a send hour outside the morning window is pinned back into it", () => {
  assert.equal(morningSendHour(8), 8);
  assert.equal(morningSendHour(3), 6);
  assert.equal(morningSendHour(21), 11);
  // Not an hour at all: the default, not a clamp that would look chosen.
  assert.equal(morningSendHour(99), 8);
  assert.equal(morningSendHour(Number.NaN), 8);

  const at = sendInstantFor(RUN_START, "America/New_York", 21);
  assert.equal(localParts("America/New_York", at).hour, 11);
});

test("digestRunDate is the Wednesday the run is for", () => {
  // Built Tuesday evening UTC, for the Wednesday that follows.
  assert.equal(
    digestRunDate(RUN_START).toISOString(),
    "2026-08-05T00:00:00.000Z",
  );
  // A retry after UTC midnight resumes the same run rather than opening a second.
  assert.equal(
    digestRunDate(new Date("2026-08-05T02:00:00Z")).toISOString(),
    "2026-08-05T00:00:00.000Z",
  );
});

test("digestWindow covers seven days from local midnight today", () => {
  // Wednesday morning in Boston.
  const now = new Date("2026-08-05T12:30:00Z");
  const window = digestWindow(now, "America/New_York");

  assert.equal(window.startDate, "2026-08-05");
  assert.equal(window.endDate, "2026-08-11");
  assert.equal(window.end.getTime() - window.start.getTime(), 7 * 24 * HOUR);
  // Starting at local midnight means tonight's shows are still included.
  assert.ok(window.start.getTime() < now.getTime());
});

test("nextWeekdayAt skips to next week once the hour has passed", () => {
  // Wednesday 12:30 UTC = 08:30 in Boston, i.e. past an 08:00 send hour.
  const afterSend = new Date("2026-08-05T12:30:00Z");
  const next = nextWeekdayAt(afterSend, "America/New_York", DIGEST_WEEKDAY, 8);
  assert.equal(next.toISOString(), "2026-08-12T12:00:00.000Z");

  // Earlier the same Wednesday, it should still be today.
  const preDawn = new Date("2026-08-05T09:00:00Z"); // 05:00 local
  assert.equal(
    nextWeekdayAt(preDawn, "America/New_York", DIGEST_WEEKDAY, 8).toISOString(),
    "2026-08-05T12:00:00.000Z",
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

test("an onsale instant IS re-zoned, unlike an event's local time", () => {
  // The distinction this protects: an event's showtime is already a venue wall
  // clock, but an onsale is one instant everybody races at once. A 10am Eastern
  // ticket drop has to read as 7am to someone in Los Angeles, or they show up
  // three hours late to a sold-out queue.
  const drop = "2026-08-08T14:00:00Z";

  assert.equal(
    formatInstantInZone(drop, "America/New_York"),
    "Sat, Aug 8, 10:00 AM",
  );
  assert.equal(
    formatInstantInZone(drop, "America/Los_Angeles"),
    "Sat, Aug 8, 7:00 AM",
  );
  // Far enough east that the same instant is the following day.
  assert.equal(formatInstantInZone(drop, "Asia/Taipei"), "Sat, Aug 8, 10:00 PM");
});

test("an unusable onsale value yields no label rather than throwing", () => {
  // Same reasoning as safeSendInstant in the planner: this runs once per
  // subscriber, and Intl throws a RangeError on an unknown zone. One bad profile
  // row must not take out the section — or the digest.
  assert.equal(formatInstantInZone(null, "America/New_York"), null);
  assert.equal(formatInstantInZone("not a date", "America/New_York"), null);
  assert.equal(formatInstantInZone("2026-08-08T14:00:00Z", "Etc/Nonsense"), null);
});
