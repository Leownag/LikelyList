import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIcs, googleCalendarUrl, icsFileName, type CalendarEvent } from "./calendar";

const BOSTON_SHOW: CalendarEvent = {
  title: "Turnstile",
  localDate: "2026-08-07",
  localTime: "20:00:00",
  timezone: "America/New_York",
  venueName: "Roadrunner",
  cityLabel: "Boston, MA",
  url: "https://www.ticketmaster.com/event/abc",
};

test("an 8pm Boston show is the same instant however it is expressed", () => {
  // The bug this guards: a venue-local clock reading treated as the reader's own time.
  // 8pm on 2026-08-07 in Boston is EDT, UTC-4, so midnight UTC on the 8th.
  const ics = buildIcs(BOSTON_SHOW);
  assert.ok(ics);
  assert.match(ics, /DTSTART:20260808T000000Z/);
  // Three hours later.
  assert.match(ics, /DTEND:20260808T030000Z/);

  // Google gets the venue-local reading plus the zone, which renders as the time on
  // the ticket rather than as a correct-but-confusing UTC range.
  const url = googleCalendarUrl(BOSTON_SHOW);
  assert.ok(url);
  assert.ok(url.includes("dates=20260807T200000%2F20260807T230000"), url);
  assert.ok(url.includes("ctz=America%2FNew_York"), url);
});

test("the zone is honoured, not the machine's own", () => {
  // Same wall clock, different coast: 8pm Pacific is 3am UTC the next day. If this
  // ever equals the Boston stamp, the timezone is being ignored somewhere.
  const pacific = buildIcs({
    ...BOSTON_SHOW,
    timezone: "America/Los_Angeles",
  });
  assert.ok(pacific);
  assert.match(pacific, /DTSTART:20260808T030000Z/);
});

test("a winter date uses standard time, not summer offset", () => {
  // January in Boston is EST, UTC-5 — one hour different from the August case. Getting
  // this wrong means every entry is an hour out for half the year.
  const winter = buildIcs({
    ...BOSTON_SHOW,
    localDate: "2027-01-15",
  });
  assert.ok(winter);
  assert.match(winter, /DTSTART:20270116T010000Z/);
});

test("a date with no time becomes an all-day entry", () => {
  // Ticketmaster confirms plenty of events without a start time. A midnight default
  // would put the show at midnight, which is worse than saying "that day".
  const ics = buildIcs({ ...BOSTON_SHOW, localTime: null });
  assert.ok(ics);
  assert.match(ics, /DTSTART;VALUE=DATE:20260807/);
  // End is exclusive in both formats, so a one-day event ends on the 8th.
  assert.match(ics, /DTEND;VALUE=DATE:20260808/);

  const url = googleCalendarUrl({ ...BOSTON_SHOW, localTime: null });
  assert.ok(url?.includes("dates=20260807%2F20260808"));
  // No ctz on an all-day entry: there is no clock reading for a zone to apply to.
  assert.ok(!url?.includes("ctz="));
});

test("iCalendar metacharacters in a band name are escaped", () => {
  // Unescaped, these do not warn — they produce a file the calendar silently rejects.
  const ics = buildIcs({
    ...BOSTON_SHOW,
    title: "Godspeed You! Black Emperor, live; with backslash \\",
    venueName: "Venue, with a comma",
  });
  assert.ok(ics);
  assert.match(ics, /SUMMARY:Godspeed You! Black Emperor\\, live\\; with backslash \\\\/);
  assert.match(ics, /LOCATION:Venue\\, with a comma\\, Boston\\, MA/);
});

test("the same show produces the same file twice", () => {
  // Deterministic UID and DTSTAMP, so re-adding updates the entry instead of creating
  // a duplicate — and so this function stays testable at all.
  assert.equal(buildIcs(BOSTON_SHOW), buildIcs(BOSTON_SHOW));
  assert.match(buildIcs(BOSTON_SHOW)!, /UID:20260808-turnstile@likelylist/);
});

test("CRLF line endings, as the spec requires", () => {
  // Outlook enforces this; a bare \n file simply fails to import.
  const ics = buildIcs(BOSTON_SHOW)!;
  assert.ok(ics.includes("\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "found a bare LF");
});

test("an unusable date or zone yields null rather than a broken entry", () => {
  assert.equal(buildIcs({ ...BOSTON_SHOW, localDate: "nonsense" }), null);
  assert.equal(buildIcs({ ...BOSTON_SHOW, localTime: "half past" }), null);
  assert.equal(googleCalendarUrl({ ...BOSTON_SHOW, localDate: "" }), null);
  // A missing zone used to fall back to UTC, and this assertion wrote that down
  // as correct: an 8pm Boston show as 20:00Z, which a calendar reads as 4pm.
  // Covered properly by "a show with no zone gets the right day rather than a
  // wrong time" below — the entry goes all-day instead of claiming an hour.
});

test("the filename is something recognisable in a downloads folder", () => {
  assert.equal(icsFileName(BOSTON_SHOW), "turnstile.ics");
  assert.equal(
    icsFileName({ ...BOSTON_SHOW, title: "Boston Calling — Day 2!" }),
    "boston-calling-day-2.ics",
  );
});

test("a show with no zone gets the right day rather than a wrong time", () => {
  // The failure this replaces: the zone fell back to UTC, so an 8pm Boston show
  // was written as 20:00Z and read 4pm in the reader's calendar — four hours
  // early, stated confidently. A pin made before events_cache carried a zone
  // still has none, so this was reachable, not theoretical.
  const ics = buildIcs({
    title: "A Show",
    localDate: "2026-08-07",
    localTime: "20:00:00",
    timezone: null,
    venueName: "The Hall",
    cityLabel: "Boston, MA",
    url: null,
  });

  assert.ok(ics);
  assert.match(ics, /DTSTART;VALUE=DATE:20260807/);
  assert.doesNotMatch(ics, /DTSTART:\d{8}T200000Z/, "still claiming 8pm UTC");

  const url = googleCalendarUrl({
    title: "A Show",
    localDate: "2026-08-07",
    localTime: "20:00:00",
    timezone: null,
    venueName: null,
    cityLabel: null,
    url: null,
  });
  assert.ok(url);
  assert.match(url, /dates=20260807%2F20260808/);
  assert.doesNotMatch(url, /ctz=/, "a zone was named for an event that has none");
});

test("an all-day entry lands on the venue's date in every US zone", () => {
  // DTSTART;VALUE=DATE is written from the UTC side of local midnight. That is
  // the venue's own date for every zone behind UTC, which is all of them here —
  // but it is one day early for anywhere ahead of it, so this pins the set the
  // product actually offers.
  for (const timezone of [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ]) {
    const ics = buildIcs({
      title: "A Show",
      localDate: "2026-08-07",
      localTime: null,
      timezone,
      venueName: null,
      cityLabel: null,
      url: null,
    });
    assert.ok(ics, timezone);
    assert.match(ics, /DTSTART;VALUE=DATE:20260807/, `${timezone} shifted the date`);
    assert.match(ics, /DTEND;VALUE=DATE:20260808/, `${timezone} shifted the end`);
  }
});

test("a show on the night the clocks go back is still at the printed hour", () => {
  // 2026-11-01 is the US fall-back date. A show at 8pm that evening is after the
  // transition, so it is EST (UTC-5) and not EDT — one hour out if the offset is
  // taken from earlier in the day.
  const ics = buildIcs({
    title: "A Show",
    localDate: "2026-11-01",
    localTime: "20:00:00",
    timezone: "America/New_York",
    venueName: null,
    cityLabel: null,
    url: null,
  });
  assert.ok(ics);
  assert.match(ics, /DTSTART:20261102T010000Z/);
});

test("a show in the hour after the clocks jump forward is not an hour late", () => {
  // 2026-03-08 is the US spring-forward Sunday: 02:00 EST becomes 03:00 EDT.
  // A 03:30 local start is on the far side of that jump, so resolving it needs
  // the offset *at the resulting instant*, not the offset at the wall-clock
  // numbers read as UTC. Taking the first reading and stopping — the usual
  // shortcut — puts this show an hour late, at 08:30Z instead of 07:30Z.
  //
  // Only reachable within a few hours of a transition, which is why the
  // schedule tests never touch it: sends are Wednesday mornings and the
  // transition is a Sunday night. A late show is not so lucky.
  const ics = buildIcs({
    title: "A Late Show",
    localDate: "2026-03-08",
    localTime: "03:30:00",
    timezone: "America/New_York",
    venueName: null,
    cityLabel: null,
    url: null,
  });
  assert.ok(ics);
  assert.match(ics, /DTSTART:20260308T073000Z/);

  // And the hour that falls back, which happens twice. Either reading is a
  // defensible answer; what matters is that it is a real instant on the right
  // date rather than NaN.
  const ambiguous = buildIcs({
    title: "An Ambiguous Show",
    localDate: "2026-11-01",
    localTime: "01:30:00",
    timezone: "America/New_York",
    venueName: null,
    cityLabel: null,
    url: null,
  });
  assert.ok(ambiguous);
  assert.match(ambiguous, /DTSTART:20261101T0[56]3000Z/);
});
