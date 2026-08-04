/**
 * Timezone arithmetic for scheduling.
 *
 * The Friday cron fires once, in UTC. Deciding *when* each subscriber receives
 * their email has to happen per user, because "Friday morning" means a
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
 * `runDate` is the run's calendar Friday (UTC). If the user's local clock is
 * already past their send hour when the run is built — which happens for zones
 * far ahead of UTC — the job becomes immediately sendable rather than waiting a
 * week.
 */
export function sendInstantFor(
  runDate: Date,
  timeZone: string,
  sendHour: number,
): Date {
  const local = localParts(timeZone, runDate);
  return zonedTimeToUtc(
    timeZone,
    local.year,
    local.month,
    local.day,
    sendHour,
  );
}

/** The digest window: the next 7 days starting at local midnight tomorrow. */
export function digestWindow(
  now: Date,
  timeZone = "America/New_York",
): { start: Date; end: Date; startDate: string; endDate: string } {
  const local = localParts(timeZone, now);

  // Start from local midnight today, so a Friday-morning email still includes
  // shows happening that same Friday night.
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

/** IANA zones offered in Settings. Kept short — these are the US markets. */
export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Asia/Taipei",
  "Asia/Tokyo",
] as const;
