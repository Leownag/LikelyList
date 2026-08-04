import { zonedTimeToUtc } from "@/lib/time";

/**
 * "Add to calendar", without a third party.
 *
 * Services like AddEvent exist to do this, and every one of them means putting a
 * script on the page that sees which events a reader is interested in. The work is a
 * URL and a short text file, so it is done here.
 *
 * The hard part is not the format, it is the time. Ticketmaster gives a venue-local
 * date and clock ("2026-08-07", "20:00:00") plus the venue's IANA zone — never an
 * instant. Treating that local time as the reader's own is the classic bug: somebody
 * in Los Angeles adds an 8pm Boston show and their calendar says 8pm Pacific, three
 * hours wrong, and they find out at the venue.
 *
 * So both outputs are built from a real instant, resolved with the venue's zone:
 * `.ics` carries UTC, and the Google URL carries local time plus an explicit `ctz`.
 * Neither leaves the reader's calendar to guess.
 */

export type CalendarEvent = {
  title: string;
  /** Venue-local, `YYYY-MM-DD`. */
  localDate: string;
  /** Venue-local `HH:MM:SS`, or null when Ticketmaster only confirmed the date. */
  localTime: string | null;
  /** The venue's IANA zone, e.g. "America/New_York". Null when unknown. */
  timezone: string | null;
  venueName: string | null;
  cityLabel: string | null;
  /** The Ticketmaster page, put in the description so the calendar entry is useful. */
  url: string | null;
};

/**
 * How long to block out.
 *
 * Three hours. Doors-to-encore for a normal gig, and it errs on the generous side
 * because the cost of a slightly long block is nothing while a 60-minute block that
 * ends mid-set makes the entry actively misleading.
 */
const DEFAULT_DURATION_HOURS = 3;

type Instants = {
  start: Date;
  end: Date;
  /** True when Ticketmaster gave no time, so this becomes an all-day entry. */
  allDay: boolean;
};

/**
 * The event as real instants, or null when the date cannot be parsed.
 *
 * Falls back to UTC when the zone is missing rather than to the server's own zone: a
 * Cloudflare worker's local time is meaningless, and UTC at least fails in a way that
 * is the same everywhere instead of depending on which datacentre answered.
 */
function resolveInstants(event: CalendarEvent): Instants | null {
  const [year, month, day] = event.localDate.split("-").map(Number);
  if (!year || !month || !day) return null;

  const zone = event.timezone || "UTC";

  if (!event.localTime) {
    // All-day. Start at local midnight, end at the next one — iCalendar and Google
    // both treat the end of an all-day range as exclusive.
    const start = zonedTimeToUtc(zone, year, month, day, 0);
    return {
      start,
      end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
      allDay: true,
    };
  }

  const [hour, minute] = event.localTime.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  let start: Date;
  try {
    start = zonedTimeToUtc(zone, year, month, day, hour, minute);
  } catch {
    // An unrecognised zone makes Intl throw. One bad row must not break the button.
    return null;
  }
  if (Number.isNaN(start.getTime())) return null;

  return {
    start,
    end: new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000),
    allDay: false,
  };
}

/** `YYYYMMDDTHHMMSSZ`, the only instant format both formats accept without argument. */
function utcStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/** `YYYYMMDD`, for all-day ranges. */
function utcDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function locationOf(event: CalendarEvent): string {
  return [event.venueName, event.cityLabel].filter(Boolean).join(", ");
}

function descriptionOf(event: CalendarEvent): string {
  const lines = ["Added from likelylist."];
  if (event.url) lines.push(event.url);
  return lines.join("\n");
}

/**
 * A Google Calendar "create event" URL.
 *
 * Uses local times plus `ctz` rather than UTC. Both are correct, but this way the
 * pre-filled form shows the reader the venue's local time, which is the time printed
 * on their ticket — a UTC range renders correctly and still looks wrong at a glance.
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
  const instants = resolveInstants(event);
  if (!instants) return null;

  const dates = instants.allDay
    ? `${utcDateStamp(instants.start)}/${utcDateStamp(instants.end)}`
    : `${localStamp(event, instants.start)}/${localStamp(event, instants.end)}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    details: descriptionOf(event),
  });

  const location = locationOf(event);
  if (location) params.set("location", location);
  if (!instants.allDay && event.timezone) params.set("ctz", event.timezone);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The instant re-expressed in the venue's zone as `YYYYMMDDTHHMMSS`, for `ctz`. */
function localStamp(event: CalendarEvent, at: Date): string {
  const zone = event.timezone || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  // Intl renders midnight as "24" in some ICU builds, which is a valid clock reading
  // and an invalid calendar stamp.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${get("year")}${get("month")}${get("day")}T${hour}${get("minute")}${get("second")}`;
}

/**
 * Escapes a value for an iCalendar property.
 *
 * Comma, semicolon and backslash are structural in this format, and a newline has to
 * become a literal `\n`. Band names contain all of these — "Godspeed You! Black
 * Emperor", "Sunn O)))", anything with a comma in the tour name — and an unescaped one
 * does not produce a warning, it produces a file the calendar silently refuses.
 */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * A single-event `.ics`, for Apple Calendar and anything else that reads the format.
 *
 * Times are UTC rather than `TZID=`. A TZID reference is only strictly valid alongside
 * a matching VTIMEZONE block — which means shipping DST rules for every US zone — and
 * clients differ on how forgiving they are about a bare one. Converting to an instant
 * sidesteps the whole question, and the instant is what a calendar stores anyway.
 *
 * CRLF line endings, because RFC 5545 requires them and Outlook enforces it.
 */
export function buildIcs(event: CalendarEvent): string | null {
  const instants = resolveInstants(event);
  if (!instants) return null;

  const location = locationOf(event);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//likelylist//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // Stable per event+start, so re-adding updates the entry rather than duplicating
    // it. No randomness, which also keeps this function pure and testable.
    `UID:${icsUid(event, instants.start)}`,
    `DTSTAMP:${utcStamp(new Date(0))}`,
    instants.allDay
      ? `DTSTART;VALUE=DATE:${utcDateStamp(instants.start)}`
      : `DTSTART:${utcStamp(instants.start)}`,
    instants.allDay
      ? `DTEND;VALUE=DATE:${utcDateStamp(instants.end)}`
      : `DTEND:${utcStamp(instants.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
  ];

  if (location) lines.push(`LOCATION:${escapeIcs(location)}`);
  lines.push(`DESCRIPTION:${escapeIcs(descriptionOf(event))}`);
  if (event.url) lines.push(`URL:${escapeIcs(event.url)}`);

  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.join("\r\n")}\r\n`;
}

/**
 * A deterministic UID.
 *
 * `DTSTAMP` is fixed at the epoch for the same reason: both exist so that adding the
 * same show twice is an update rather than a second entry, and a clock reading would
 * make every download a different file.
 */
function icsUid(event: CalendarEvent, start: Date): string {
  const slug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${utcDateStamp(start)}-${slug || "event"}@likelylist`;
}

/** A filename a reader will recognise in their downloads folder. */
export function icsFileName(event: CalendarEvent): string {
  const slug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${slug || "event"}.ics`;
}
