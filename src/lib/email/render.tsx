import { render } from "@react-email/render";
import type { Digest } from "@/lib/digest/types";
import { MAX_EMAIL_EVENTS, MAX_ONSALE_EVENTS } from "@/lib/digest/types";
import { DigestEmail, appLink } from "./digest-email";
import { formatInstantInZone } from "@/lib/time";

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

  // Above the listings, matching the HTML. Rendered even when nothing else
  // matched: a week with no shows can still have a drop worth catching.
  if (digest.onsale.length > 0) {
    lines.push("ON SALE THIS WEEK");
    for (const item of digest.onsale) {
      const place = [item.venueName, item.cityLabel].filter(Boolean).join(", ");
      lines.push(`* ${item.name}${place ? ` — ${place}` : ""} · ${item.dateLabel}`);
      const when = formatInstantInZone(item.onsaleStart, digest.timezone);
      lines.push(`    on sale ${when ?? "date announced"}`);
      if (item.matchedArtists.length > 0) {
        lines.push(`    because you follow ${item.matchedArtists.join(", ")}`);
      }
      if (item.url) lines.push(`    ${item.url}`);
    }
    lines.push("");
  }

  if (digest.totalEventCount === 0) {
    lines.push("Nothing matched this week.");
    lines.push("");
    lines.push(
      digest.cities.length === 0
        ? "You haven't followed any cities yet."
        : "No listed shows matched your genres or artists.",
    );
    lines.push(
      `Widen your filters: ${appLink(digest.siteUrl, "/app/subscriptions")}`,
    );
  } else {
    // Same disclosure as the HTML banner. A text-only reader must not be the one
    // person who gets an unfiltered list presented as a filtered one.
    if (digest.fallbackReason === "no_preferences") {
      lines.push(
        `You haven't told us what you listen to yet, so this is everything listed in ${
          digest.cities.join(", ") || "your cities"
        } — not a filtered selection.`,
      );
      lines.push(
        `Pick your genres: ${appLink(digest.siteUrl, "/app/subscriptions")}`,
      );
      lines.push("");
    }

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
  lines.push(
    `Change what you follow: ${appLink(digest.siteUrl, "/app/subscriptions")}`,
  );
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
    onsale: digest.onsale.slice(0, MAX_ONSALE_EVENTS),
  };

  // Enough attempts to shed every onsale row and then every event but one. Sized
  // from the caps rather than left at a round number, so raising either cap cannot
  // silently leave the loop unable to reach a size that fits.
  const maxAttempts = MAX_ONSALE_EVENTS + MAX_EMAIL_EVENTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rendered = await renderDigestEmail(working);
    if (rendered.bytes <= SIZE_BUDGET) return rendered;

    const smaller = shrinkOneStep(working);
    if (!smaller) return rendered;
    working = smaller;
  }

  return renderDigestEmail(working);
}

/**
 * One step smaller, or null when there is nothing left to give up.
 *
 * Pure and exported so the *order* of sacrifice can be tested directly. Testing
 * it through renderWithinSizeBudget would mean constructing a digest that really
 * exceeds 96 KB, which makes the test a slow hostage to how compact the template
 * currently happens to be.
 *
 * The order is the point: onsale rows go first because they cost a line of text,
 * whereas every dropped event is a listing the reader never sees — and shows are
 * what they subscribed for. The last event is never dropped, because an email with
 * nothing in it is not worth sending.
 */
export function shrinkOneStep(digest: Digest): Digest | null {
  if (digest.onsale.length > 0) {
    return { ...digest, onsale: digest.onsale.slice(0, -1) };
  }

  if (digest.events.length <= 1) return null;

  // `totalEventCount` is deliberately left alone so the "view all" link still
  // reports the true number.
  return { ...digest, events: digest.events.slice(0, -1) };
}
