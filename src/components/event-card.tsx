import { Card } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import { ServiceLink } from "@/components/service-icon";
import { AddToCalendar } from "@/components/add-to-calendar";
import { PinButton } from "@/components/pin-button";
import { spotifySearchUrl, youtubeSearchUrl } from "@/lib/enrich/links";
import type { PinInput } from "@/lib/pins/types";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/locales";

/**
 * One show, as My feed and Pinned both render it.
 *
 * Shared because the two pages show the same thing and a reader moving between them
 * should not have to re-learn a layout. It takes a PinInput rather than a page-specific
 * shape, which means the pin button already has everything it needs to store — no
 * second mapping, and no way for the pinned copy to drift from what was on screen.
 *
 * YouTube and Spotify links are derived from the performer name here rather than stored.
 * A search URL cannot rot, and storing one per performer per pin would be copying
 * something we can always recompute.
 */
export async function EventCard({
  event,
  pinned,
  signedIn,
  /** Why this show is in the reader's feed, when we can say. */
  becauseOf,
}: {
  event: PinInput;
  pinned: boolean;
  signedIn: boolean;
  becauseOf?: string[];
}) {
  const { locale, t } = await getI18n();
  const dateLabel = formatDate(event.localDate, t("card.dateTba"), locale);
  const timeLabel = formatTime(event.localTime, locale);
  const place = [event.venueName, event.cityLabel].filter(Boolean).join(" · ");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-accent">
          {dateLabel}
          {timeLabel ? ` · ${timeLabel}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AddToCalendar
            event={{
              title: event.name,
              localDate: event.localDate ?? "",
              localTime: event.localTime,
              timezone: event.timezone,
              venueName: event.venueName,
              cityLabel: event.cityLabel,
              url: event.url,
            }}
          />
          <PinButton event={event} initiallyPinned={pinned} signedIn={signedIn} />
        </div>
      </div>

      <h2 className="mt-1.5 text-base font-semibold tracking-tight">
        {event.url ? (
          <a
            href={event.url}
            className="hover:underline"
            rel="noreferrer noopener"
            target="_blank"
          >
            {event.name}
          </a>
        ) : (
          event.name
        )}
      </h2>

      {place || event.genreName ? (
        <p className="mt-1 text-sm text-muted">
          {place}
          {event.genreName ? `${place ? " · " : ""}${event.genreName}` : ""}
        </p>
      ) : null}

      {becauseOf && becauseOf.length > 0 ? (
        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-pixel-3">
          <PixelDot size={5} color="var(--pixel-3)" />
          because you follow {becauseOf.join(", ")}
        </p>
      ) : null}

      {event.performers.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {event.performers.map((performer) => (
            <li key={performer.name} className="flex items-center gap-1.5">
              <PixelDot
                size={5}
                color={
                  performer.isHeadliner
                    ? "var(--pixel-1)"
                    : "var(--border-strong)"
                }
              />
              <span className="text-text">{performer.name}</span>
              <ServiceLink
                service="youtube"
                href={youtubeSearchUrl(performer.name)}
                className="text-xs"
              />
              <ServiceLink
                service="spotify"
                href={spotifySearchUrl(performer.name)}
                className="text-xs"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/**
 * "Fri, Aug 7" from a venue-local date, without re-zoning it.
 *
 * Constructed and formatted as UTC on purpose: the date is already local to the venue,
 * so applying any timezone would shift an evening show to the previous day. Same
 * reasoning as formatEventDate in lib/time, duplicated here only because this component
 * receives a nullable date.
 */
function formatDate(localDate: string | null, dateTba: string, locale: Locale): string {
  if (!localDate) return dateTba;
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return dateTba;

  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTime(localTime: string | null, locale: Locale): string | null {
  if (!localTime) return null;
  const [hour, minute] = localTime.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}
