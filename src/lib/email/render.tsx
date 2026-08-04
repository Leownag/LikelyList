import { render } from "@react-email/render";
import type { Digest } from "@/lib/digest/types";
import { MAX_EMAIL_EVENTS } from "@/lib/digest/types";
import { DigestEmail } from "./digest-email";

/**
 * Gmail clips a message body larger than this and hides everything below the
 * cut — including the unsubscribe link, which is exactly the thing that must
 * never be unreachable. Kept a little under 102400 for headers and encoding.
 */
export const GMAIL_CLIP_BYTES = 102_400;
const SIZE_BUDGET = 96_000;

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  bytes: number;
};

export async function renderDigestEmail(digest: Digest): Promise<RenderedEmail> {
  const element = <DigestEmail digest={digest} />;

  const html = await render(element);
  const text = buildPlainText(digest);

  const bytes = new TextEncoder().encode(html).length;

  return { subject: buildSubject(digest), html, text, bytes };
}

function buildSubject(digest: Digest): string {
  if (digest.totalEventCount === 0) {
    return `Nothing matched this week (${digest.windowLabel})`;
  }

  const names = digest.events
    .slice(0, 2)
    .map((event) => event.performers.find((p) => p.isHeadliner)?.name ?? event.name);

  const extra = digest.totalEventCount - names.length;
  const tail = extra > 0 ? ` and ${extra} more` : "";
  return `${names.join(", ")}${tail} — ${digest.windowLabel}`;
}

/**
 * Plain-text alternative.
 *
 * Written by hand rather than derived from the HTML: an auto-converted table
 * layout reads as noise, and the text part is what some clients and most
 * accessibility tooling actually show. It carries the same information,
 * including the unsubscribe link.
 */
export function buildPlainText(digest: Digest): string {
  const lines: string[] = [];

  lines.push("LIKELYLIST");
  lines.push(
    `${digest.windowLabel}${digest.cities.length ? ` · ${digest.cities.join(", ")}` : ""}`,
  );
  lines.push("");

  if (digest.totalEventCount === 0) {
    lines.push("Nothing matched this week.");
    lines.push("");
    lines.push(
      digest.cities.length === 0
        ? "You haven't followed any cities yet."
        : "No listed shows matched your genres or artists.",
    );
    lines.push(`Widen your filters: ${digest.siteUrl}/app/subscriptions`);
  } else {
    for (const event of digest.events.slice(0, MAX_EMAIL_EVENTS)) {
      lines.push(
        `${event.dateLabel}${event.timeLabel ? ` ${event.timeLabel}` : ""} — ${event.name}`,
      );
      const place = [event.venueName, event.cityLabel].filter(Boolean).join(", ");
      if (place) lines.push(`  ${place}`);
      if (event.genreName) lines.push(`  ${event.genreName}`);
      if (event.matchedArtists.length > 0) {
        lines.push(`  because you follow ${event.matchedArtists.join(", ")}`);
      }

      for (const performer of event.performers) {
        const label = performer.isHeadliner ? "headliner" : "same bill";
        lines.push(`  * ${performer.name} (${label})`);
        lines.push(`      YouTube: ${performer.youtubeUrl}`);
        lines.push(`      Spotify: ${performer.spotifyUrl}`);
      }

      if (event.url) lines.push(`  Tickets: ${event.url}`);
      lines.push("");
    }

    const remaining = digest.totalEventCount - Math.min(
      digest.totalEventCount,
      MAX_EMAIL_EVENTS,
    );
    if (remaining > 0) {
      lines.push(`All ${digest.totalEventCount} shows: ${digest.previewUrl}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push(`View in browser: ${digest.previewUrl}`);
  lines.push(`Change what you follow: ${digest.siteUrl}/app/subscriptions`);
  lines.push(`Privacy: ${digest.siteUrl}/privacy`);
  lines.push(`Unsubscribe: ${digest.unsubscribeUrl}`);
  lines.push("");
  lines.push(
    "Event listings and images via Ticketmaster. Video links via YouTube " +
      "(https://www.youtube.com/t/terms). Ticketmaster does not publish billing " +
      "order, so acts we cannot identify from the event title are listed as " +
      "sharing the bill rather than as opening acts.",
  );

  return lines.join("\n");
}

/**
 * Trims the digest until the rendered email fits under the clip threshold.
 *
 * The event cap alone is usually enough, but a bill with a dozen performers can
 * still push a single card over budget, so this measures the real output and
 * drops events until it fits rather than assuming.
 */
export async function renderWithinSizeBudget(
  digest: Digest,
): Promise<RenderedEmail> {
  // Trim to what the template will actually render first. Reducing a 40-event
  // list to 28 changes nothing when only the first MAX_EMAIL_EVENTS are shown,
  // so measuring before this truncation would loop without ever shrinking.
  let working: Digest = {
    ...digest,
    events: digest.events.slice(0, MAX_EMAIL_EVENTS),
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    const rendered = await renderDigestEmail(working);
    if (rendered.bytes <= SIZE_BUDGET || working.events.length <= 1) {
      return rendered;
    }
    // Drop the lowest-ranked events. `totalEventCount` is deliberately left
    // alone so the "view all" link still reports the true number.
    working = {
      ...working,
      events: working.events.slice(0, working.events.length - 1),
    };
  }

  return renderDigestEmail(working);
}
