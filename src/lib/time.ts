/**
 * Timezone arithmetic for scheduling.
 *
 * The weekly cron fires once, in UTC. Deciding *when* each subscriber receives
 * their email has to happen per user, because "Wednesday morning" means a
 * different instant in Boston and in Taipei — and because a UTC cron expression
 * silently drifts by an hour twice a year when the recipient observes DST.
 *
 * Implemented on Intl rather than a date library so it works unchanged in the
 * Workers runtime, which has full ICU but no Node timezone database access.
 */

/** Milliseconds to add to UTC to get local wall-clock time in `timeZone`. */
export function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asIfUtc - at.getTime();
}

/**
 * The UTC instant at which the given local wall-clock time occurs.
 *
 * Resolved in two passes: the first guess uses the offset at the *UTC* reading
 * of those numbers, which is wrong by up to an hour near a DST transition, so
 * the offset is recomputed at the corrected instant. A third pass would gain
 * nothing — offsets do not change twice within an hour.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = new Date(naive - timeZoneOffsetMs(timeZone, new Date(naive)));
  const corrected = naive - timeZoneOffsetMs(timeZone, firstGuess);
  return new Date(corrected);
}

/** Local calendar parts in `timeZone` for a given instant. */
export function localParts(
  timeZone: string,
  at: Date,
): { year: number; month: number; day: number; hour: number; weekday: number } {
  const offset = timeZoneOffsetMs(timeZone, at);
  const shifted = new Date(at.getTime() + offset);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    // 0 = Sunday, matching Date#getUTCDay.
    weekday: shifted.getUTCDay(),
  };
}

/** `YYYY-MM-DD` for the local date in `timeZone`. */
export function localDateString(timeZone: string, at: Date): string {
  const { year, month, day } = localParts(timeZone, at);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The instant at which this user should receive the digest for a run.
 *
 * Anchored on the reader's own next DIGEST_WEEKDAY rather than on whatever
 * calendar day the run happens to fall on in their zone. The two are not the
 * same day: the builder fires on a Tuesday evening in UTC, which is already
 * Wednesday in Tokyo and still Tuesday in Honolulu, so reading the weekday off
 * the run instant hands zones far enough from UTC the wrong day entirely.
 *
 * If that local morning has already passed when the run is built, the job
 * becomes immediately sendable rather than waiting a week.
 */
export function sendInstantFor(
  runStart: Date,
  timeZone: string,
  sendHour: number,
): Date {
  const local = localParts(timeZone, runStart);
  const daysAhead = (DIGEST_WEEKDAY - local.weekday + 7) % 7;
  const target = zonedTimeToUtc(
    timeZone,
    local.year,
    local.month,
    local.day + daysAhead,
    morningSendHour(sendHour),
  );
  return target.getTime() < runStart.getTime() ? runStart : target;
}

/**
 * The UTC calendar date a run building at `now` is for.
 *
 * The first DIGEST_WEEKDAY at or after `now`, in UTC. Used both as the run's
 * key — so a retry either side of UTC midnight resumes the same run instead of
 * opening a second one — and as the anchor for the listings window, which has
 * to start on the day the email is read, not the evening it is assembled.
 */
export function digestRunDate(now: Date): Date {
  const daysAhead = (DIGEST_WEEKDAY - now.getUTCDay() + 7) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead),
  );
}

/** The digest window: the next 7 days starting at local midnight tomorrow. */
export function digestWindow(
  now: Date,
  timeZone = "America/New_York",
): { start: Date; end: Date; startDate: string; endDate: string } {
  const local = localParts(timeZone, now);

  // Start from local midnight today, so a Wednesday-morning email still
  // includes shows happening that same Wednesday night.
  const start = zonedTimeToUtc(timeZone, local.year, local.month, local.day, 0);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  return {
    start,
    end,
    startDate: localDateString(timeZone, start),
    // The window is exclusive at the end; subtract a minute so the label reads
    // as the last day actually covered.
    endDate: localDateString(timeZone, new Date(end.getTime() - 60_000)),
  };
}

/** Next occurrence of `weekday` (0=Sun) at `hour` local time, in `timeZone`. */
export function nextWeekdayAt(
  now: Date,
  timeZone: string,
  weekday: number,
  hour: number,
): Date {
  const local = localParts(timeZone, now);
  let daysAhead = (weekday - local.weekday + 7) % 7;
  if (daysAhead === 0 && local.hour >= hour) daysAhead = 7;

  const target = zonedTimeToUtc(
    timeZone,
    local.year,
    local.month,
    local.day + daysAhead,
    hour,
  );
  return target;
}

/**
 * The digest goes out midweek, in the reader's own timezone.
 *
 * Wednesday rather than Friday: the week it covers starts the morning it lands,
 * so a Friday email spent two of its seven days on a weekend already booked.
 * Midweek is when there is still something to do about a Saturday show.
 */
export const DIGEST_WEEKDAY = 3;

/**
 * The hours Settings offers for delivery.
 *
 * A morning window, not the full day: "Wednesday morning" is the promise the
 * landing page makes, and an hour outside it would quietly make that false.
 */
export const DIGEST_SEND_HOURS = [6, 7, 8, 9, 10, 11] as const;

export const DEFAULT_SEND_HOUR = 8;

/**
 * A stored send hour, pinned to the window above.
 *
 * Applied on the way out rather than written back: profiles predate the morning
 * window and the column's CHECK still allows 0–23, so a legacy 21:00 would
 * otherwise schedule a Wednesday *evening* send. An hour that is not a real
 * hour at all falls back to the default instead of clamping, since clamping
 * nonsense to 11:00 would look deliberate.
 */
export function morningSendHour(hour: number): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return DEFAULT_SEND_HOUR;
  const first = DIGEST_SEND_HOURS[0];
  const last = DIGEST_SEND_HOURS[DIGEST_SEND_HOURS.length - 1];
  return Math.min(Math.max(hour, first), last);
}

/**
 * When the next digest lands, spelled out for the reader.
 *
 * The reader's locale, not en-US: an English weekday inside Chinese body copy is
 * the most visible way a "translated" page announces that it is not.
 *
 * No minutes. Cloudflare spreads a scheduled trigger across the hour it fires
 * in, which the settings page says in as many words — so printing "8:00 AM"
 * beside that was the page contradicting itself. The hour is the most precise
 * thing this system can honestly promise, and callers wrap it in "around".
 */
export function nextDigestLabel(
  profile: { timezone: string; digest_send_hour: number },
  locale: string,
  now = new Date(),
): string {
  const next = nextWeekdayAt(
    now,
    profile.timezone,
    DIGEST_WEEKDAY,
    morningSendHour(profile.digest_send_hour),
  );
  return new Intl.DateTimeFormat(locale, {
    timeZone: profile.timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    timeZoneName: "short",
  }).format(next);
}

/** "Fri, Aug 7" style label for an event's local date, without re-zoning it. */
export function formatEventDate(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return localDate;
  // Constructed as UTC and formatted as UTC: `localDate` is already the local
  // date at the venue, so applying any timezone would shift it by a day.
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** "8:00 PM" from Ticketmaster's `HH:MM:SS` local time, or null. */
export function formatEventTime(localTime: string | null): string | null {
  if (!localTime) return null;
  const [hourText, minuteText] = localTime.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * "Fri, Aug 8 · 10:00 AM" for an absolute instant, in the reader's own timezone.
 *
 * Unlike formatEventDate/formatEventTime, which deliberately do *not* re-zone
 * because a venue's local showtime is already local, this one must: an onsale is a
 * single instant everyone races at once, and someone in Los Angeles needs to read
 * a 10am-Eastern drop as 7am. Both parts come from one formatter call so the date
 * and time can never disagree about which side of midnight they are on.
 *
 * Returns null for a missing or unparseable instant, which the caller treats as
 * "no onsale to announce".
 */
export function formatInstantInZone(
  instant: string | null,
  timeZone: string,
): string | null {
  if (!instant) return null;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
      .format(date)
      // ICU is not consistent about the date/time separator across versions — some
      // emit "Fri, Aug 8, 10:00 AM" and others "Fri, Aug 8 at 10:00 AM". Normalise
      // the second form so the output does not depend on the runtime's ICU build.
      .replace(" at ", ", ");
  } catch {
    // An unrecognised timezone makes Intl throw a RangeError. One bad profile row
    // must not lose the whole digest.
    return null;
  }
}

/**
 * IANA zones offered in Settings.
 *
 * US only, because the listings are. London, Taipei and Tokyo were on this list
 * and could never match an event — picking one scheduled a weekly email about
 * shows thousands of miles away, delivered at a sensible local hour.
 *
 * Dropping them also tightens the send window the cron is built around: with
 * New York the easternmost zone, every send lands on the same UTC day as the
 * run. See wrangler.jsonc.
 */
export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

/**
 * A stored zone, pinned to the ones still offered.
 *
 * Same shape of problem as morningSendHour, and the same fix. Profiles predate
 * the US-only list, so a row may still say Asia/Taipei — and a `<select>` whose
 * value is not among its options silently displays the first one, which the
 * next save would then write. Clamping on the way out keeps what is shown and
 * what is stored in agreement.
 *
 * Sending is unaffected either way: sendInstantFor handles any IANA zone, so an
 * untouched legacy profile keeps getting its email at the right local hour.
 */
export function supportedTimezone(zone: string): (typeof TIMEZONES)[number] {
  return (TIMEZONES as readonly string[]).includes(zone)
    ? (zone as (typeof TIMEZONES)[number])
    : "America/New_York";
}

/**
 * What to call each of those in a dropdown.
 *
 * The raw IANA name leaked to the reader — "America/New_York", underscore and
 * all — which is a database key, not a thing anyone calls their timezone.
 */
export const TIMEZONE_LABELS: Record<(typeof TIMEZONES)[number], string> = {
  "America/New_York": "Eastern — New York",
  "America/Chicago": "Central — Chicago",
  "America/Denver": "Mountain — Denver",
  "America/Phoenix": "Mountain, no DST — Phoenix",
  "America/Los_Angeles": "Pacific — Los Angeles",
  "America/Anchorage": "Alaska — Anchorage",
  "Pacific/Honolulu": "Hawaii — Honolulu",
};
