import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { Digest, DigestEvent, DigestPerformer } from "@/lib/digest/types";
import { MAX_EMAIL_EVENTS, MAX_EMAIL_PERFORMERS } from "@/lib/digest/types";
import { formatInstantInZone } from "@/lib/time";
import {
  serviceIconUrl,
  serviceLabel,
  type LinkService,
} from "@/components/service-icon";

/**
 * The weekly digest email.
 *
 * Constraints that shaped every decision here:
 *
 *  - Tables and inline styles only. No flexbox, no grid, no border-radius —
 *    Classic Outlook renders through Word and ignores all three.
 *  - It must read perfectly with images switched off. A meaningful share of
 *    recipients never load them, and alt text is now a deliverability signal in
 *    its own right, so every image carries styled alt text and no information
 *    exists only inside a picture.
 *  - It must stay under ~100 KB. Gmail clips a longer body and hides everything
 *    past the cut, including the unsubscribe link. Hence MAX_EMAIL_EVENTS and
 *    the "view all" link out to the web version.
 *  - Thumbnails are hotlinked from Ticketmaster's CDN. That is the compliant
 *    choice as well as the practical one: those URLs are stable, whereas
 *    Spotify's image URLs expire and an email lives in an inbox for weeks.
 *
 * The palette is dark to match the site. Every element therefore sets an
 * explicit colour AND background, so a client that ignores the body background
 * still renders readable text rather than white-on-white.
 */

const BG = "#0a0a0a";
const SURFACE = "#141414";
const BORDER = "#262626";
const TEXT = "#fafafa";
const MUTED = "#a1a1aa";
const FAINT = "#71717a";
const ACCENT = "#e4ff3f";
const PIXELS = ["#e4ff3f", "#ff4d6d", "#4dd8ff"];

// A pixel font cannot be loaded in an email, so the wordmark leans on tracking
// and a monospace stack instead.
const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * A link into the signed-in app, routed through /login.
 *
 * A digest is opened in whatever browser the mail client hands it to, which
 * usually holds no session — and an /app page with no session redirects to /login
 * without remembering where the reader was going, so the promise in the link text
 * ("change what you follow") silently turns into a generic sign-in page. Passing
 * `next` means one emailed link plus one magic-link click lands on the actual
 * page. Someone who *is* already signed in is forwarded straight there.
 */
export function appLink(siteUrl: string, path: string): string {
  return `${siteUrl}/login?next=${encodeURIComponent(path)}`;
}

export function DigestEmail({ digest }: { digest: Digest }) {
  const shown = digest.events.slice(0, MAX_EMAIL_EVENTS);
  const remaining = digest.totalEventCount - shown.length;

  const preview =
    shown.length === 0
      ? `No matches in ${digest.cities.join(", ") || "your cities"} this week`
      : `${digest.totalEventCount} show${digest.totalEventCount === 1 ? "" : "s"} — ${shown
          .slice(0, 3)
          .map((event) => headlinerName(event) ?? event.name)
          .join(", ")}`;

  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: BG,
          color: TEXT,
          fontFamily: SANS,
        }}
      >
        <Container
          style={{
            width: "100%",
            maxWidth: "600px",
            margin: "0 auto",
            padding: "24px 16px 40px",
            backgroundColor: BG,
          }}
        >
          <Header
            windowLabel={digest.windowLabel}
            cities={digest.cities}
            siteUrl={digest.siteUrl}
            ordering={shown.length > 1 ? digest.ordering : null}
          />

          <PixelStrip seed={digest.userId} />

          {digest.fallbackReason === "no_preferences" && shown.length > 0 ? (
            <UnfilteredNotice digest={digest} />
          ) : null}

          {/* Above the shows on purpose. Everything below is happening within
              seven days, which for anything in demand means the decision has
              already been made for you; this is the part still open. */}
          {digest.onsale.length > 0 ? (
            <OnsaleSection digest={digest} />
          ) : null}

          {shown.length === 0 ? (
            <EmptyWeek digest={digest} />
          ) : (
            shown.map((event) => (
              <EventCard
              key={event.tmEventId}
              event={event}
              siteUrl={digest.siteUrl}
            />
            ))
          )}

          {remaining > 0 ? (
            <Section style={{ marginTop: "8px", textAlign: "center" as const }}>
              <Link
                href={digest.previewUrl}
                style={{
                  display: "inline-block",
                  padding: "10px 18px",
                  backgroundColor: ACCENT,
                  color: BG,
                  fontFamily: SANS,
                  fontSize: "13px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                View all {digest.totalEventCount} shows
              </Link>
            </Section>
          ) : null}

          <Footer digest={digest} />
        </Container>
      </Body>
    </Html>
  );
}

function Header({
  windowLabel,
  cities,
  siteUrl,
  ordering,
}: {
  windowLabel: string;
  cities: string[];
  siteUrl: string;
  /** Null when there is nothing to order. */
  ordering: "relevance" | "date" | null;
}) {
  return (
    <Section style={{ paddingBottom: "16px" }}>
      {/*
        The mark, then the name — the same lockup the app and the auth emails use, so
        the thing someone recognises in a crowded inbox is one thing rather than
        three. A PNG rather than the table cells used by PixelStrip below, because
        Gmail renders nothing for those; see scripts/build-logo.ts.
      */}
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ borderCollapse: "collapse" as const }}
      >
        <tbody>
          <tr>
            <td
              valign="middle"
              style={{ paddingRight: "12px", backgroundColor: BG }}
            >
              <Img
                src={`${siteUrl}/logo-mark.png`}
                width="36"
                height="30"
                // Decorative: the wordmark is live text right beside it, so a label
                // here would only make a screen reader say the name twice.
                alt=""
                style={{ display: "block", border: 0 }}
              />
            </td>
            <td valign="middle" style={{ backgroundColor: BG }}>
              <Text
                style={{
                  margin: 0,
                  fontFamily: MONO,
                  fontSize: "16px",
                  letterSpacing: "0.22em",
                  textTransform: "uppercase" as const,
                  color: TEXT,
                }}
              >
                likelylist
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
      <Text
        style={{
          margin: "8px 0 0",
          fontFamily: SANS,
          fontSize: "13px",
          color: MUTED,
        }}
      >
        {windowLabel}
        {cities.length > 0 ? ` · ${cities.join(", ")}` : ""}
        {/*
          Names the sort this actually is. A reader who follows only genres gets an
          identical score on every event — each explicit genre weighs exactly 1.0 — so
          the list is chronological, and implying it was ranked for them would be a
          claim the data cannot support. There is no honest tiebreaker to add:
          Ticketmaster publishes no popularity or listing-count signal.
        */}
        {ordering
          ? ` · ${ordering === "relevance" ? "best matches first" : "in date order"}`
          : ""}
      </Text>
    </Section>
  );
}

/**
 * The pixel-block motif from the site, rebuilt as 8px table cells with bgcolor.
 *
 * A CSS grid would not survive Outlook and a background image would be stripped;
 * coloured table cells render everywhere, including with images blocked, because
 * there is no image involved.
 */
function PixelStrip({ seed }: { seed: string }) {
  const cells = pixelPattern(seed, 24);

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ borderCollapse: "collapse" as const, margin: "0 0 20px" }}
    >
      <tbody>
        <tr>
          {cells.map((color, index) => (
            <td
              key={index}
              width={8}
              height={8}
              // `bgcolor` is a deprecated HTML attribute and absent from React's
              // types, but Classic Outlook honours it where it ignores the CSS
              // background, so it is spread in alongside the inline style.
              {...{ bgcolor: color ?? BG }}
              style={{
                width: "8px",
                height: "8px",
                lineHeight: "8px",
                fontSize: 0,
                backgroundColor: color ?? BG,
              }}
            >
              &nbsp;
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function EventCard({
  event,
  siteUrl,
}: {
  event: DigestEvent;
  siteUrl: string;
}) {
  const headliner = event.performers.find((p) => p.isHeadliner) ?? null;
  const rest = event.performers.filter((p) => p !== headliner);

  // A long festival bill is the main thing that pushes an email past Gmail's
  // clipping threshold, so the tail is summarised rather than listed.
  const listed = rest.slice(0, MAX_EMAIL_PERFORMERS - (headliner ? 1 : 0));
  const hidden = rest.length - listed.length;

  return (
    <Section
      style={{
        marginBottom: "16px",
        border: `1px solid ${BORDER}`,
        backgroundColor: SURFACE,
      }}
    >
      <Row>
        <Column
          style={{ padding: "16px", verticalAlign: "top" as const, width: "100%" }}
        >
          <Text
            style={{
              margin: 0,
              fontFamily: MONO,
              fontSize: "12px",
              color: ACCENT,
            }}
          >
            {event.dateLabel}
            {event.timeLabel ? ` · ${event.timeLabel}` : ""}
          </Text>

          <Text
            style={{
              margin: "6px 0 0",
              fontFamily: SANS,
              fontSize: "17px",
              fontWeight: 600,
              lineHeight: "1.3",
              color: TEXT,
            }}
          >
            {event.url ? (
              <Link
                href={event.url}
                style={{ color: TEXT, textDecoration: "none" }}
              >
                {event.name}
              </Link>
            ) : (
              event.name
            )}
          </Text>

          <Text
            style={{
              margin: "6px 0 0",
              fontFamily: SANS,
              fontSize: "13px",
              color: MUTED,
            }}
          >
            {[event.venueName, event.cityLabel].filter(Boolean).join(" · ")}
            {event.genreName ? ` · ${event.genreName}` : ""}
          </Text>

          {event.matchedArtists.length > 0 ? (
            <Text
              style={{
                margin: "8px 0 0",
                fontFamily: MONO,
                fontSize: "11px",
                color: "#4dd8ff",
              }}
            >
              because you follow {event.matchedArtists.join(", ")}
            </Text>
          ) : null}

          {event.imageUrl ? (
            <Img
              src={event.imageUrl}
              alt={`Promotional image for ${event.name}`}
              width={280}
              height={157}
              style={{
                display: "block",
                border: 0,
                marginTop: "12px",
                maxWidth: "100%",
                // Styled so blocked images still read as a sensible line of text
                // rather than a broken-image glyph with tiny default type.
                fontFamily: SANS,
                fontSize: "12px",
                color: FAINT,
                backgroundColor: BG,
              }}
            />
          ) : null}

          {headliner ? (
            <PerformerRow
              performer={headliner}
              label="headliner"
              siteUrl={siteUrl}
            />
          ) : null}
          {listed.map((performer) => (
            <PerformerRow
              key={performer.name}
              performer={performer}
              siteUrl={siteUrl}
              // Ticketmaster exposes no billing order, so anyone we could not
              // identify from the title is described as sharing the bill rather
              // than being given a role we cannot substantiate.
              label={headliner ? "same bill" : "on the bill"}
            />
          ))}

          {hidden > 0 ? (
            <Text
              style={{
                margin: "10px 0 0",
                fontFamily: MONO,
                fontSize: "11px",
                color: FAINT,
              }}
            >
              {/* One interpolated string, not adjacent text nodes: React's
                  server renderer separates sibling text with <!-- --> comments,
                  which would break the line up in some clients. */}
              {`+ ${hidden} more on the bill`}
              {event.url ? (
                <>
                  {" — "}
                  <Link
                    href={event.url}
                    style={{ color: FAINT, textDecoration: "underline" }}
                  >
                    see the full lineup
                  </Link>
                </>
              ) : null}
            </Text>
          ) : null}

          {event.url ? (
            <Text style={{ margin: "14px 0 0" }}>
              <Link
                href={event.url}
                style={{
                  fontFamily: SANS,
                  fontSize: "13px",
                  fontWeight: 600,
                  color: ACCENT,
                  textDecoration: "underline",
                }}
              >
                Tickets on Ticketmaster
              </Link>
            </Text>
          ) : null}
        </Column>
      </Row>
    </Section>
  );
}

/**
 * One performer: name, billing label, and the two outbound links.
 *
 * Deliberately flat — one table, one row, two text nodes. The first version
 * nested a table inside a td inside a table per performer and carried a 48x32
 * thumbnail each. At ten events that came to forty images and about 130 KB, which
 * is past the point where Gmail clips the body and hides the unsubscribe link.
 *
 * The per-performer thumbnail is gone rather than shrunk: every card already has
 * a hero image, and Gmail fetches every image the moment a message is delivered,
 * so forty extra requests bought very little.
 */
function PerformerRow({
  performer,
  label,
  siteUrl,
}: {
  performer: DigestPerformer;
  label: string;
  siteUrl: string;
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={{
        borderCollapse: "collapse" as const,
        marginTop: "10px",
        borderTop: `1px solid ${BORDER}`,
      }}
    >
      <tbody>
        <tr>
          <td style={{ paddingTop: "8px" }}>
            <Text
              style={{
                margin: 0,
                fontFamily: SANS,
                fontSize: "14px",
                color: TEXT,
              }}
            >
              {performer.tmUrl ? (
                <Link
                  href={performer.tmUrl}
                  style={{ color: TEXT, textDecoration: "none" }}
                >
                  {performer.name}
                </Link>
              ) : (
                performer.name
              )}
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: "10px",
                  textTransform: "uppercase" as const,
                  color: FAINT,
                  paddingLeft: "8px",
                }}
              >
                {label}
              </span>
            </Text>
            <Text
              style={{
                margin: "3px 0 0",
                fontFamily: SANS,
                fontSize: "12px",
                color: MUTED,
              }}
            >
              <EmailServiceLink
                service="youtube"
                href={performer.youtubeUrl}
                siteUrl={siteUrl}
              />
              <span style={{ color: FAINT }}> · </span>
              <EmailServiceLink
                service="spotify"
                href={performer.spotifyUrl}
                siteUrl={siteUrl}
              />
            </Text>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Ticket drops in the coming week.
 *
 * No artwork and no performer rows, unlike EventCard. Two reasons: these rows sit
 * above the week's listings and must not push them off the first screen, and they
 * are the first thing renderWithinSizeBudget sheds, so being cheap is what lets
 * them exist at all.
 *
 * Times are rendered in the reader's own timezone — an onsale is one instant that
 * everybody races at once, so "10:00 AM" has to mean 10am where they are.
 */
function OnsaleSection({ digest }: { digest: Digest }) {
  return (
    <Section style={{ marginBottom: "20px" }}>
      <Text
        style={{
          margin: "0 0 8px",
          fontFamily: MONO,
          fontSize: "11px",
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
          color: ACCENT,
        }}
      >
        On sale this week
      </Text>

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        width="100%"
        style={{
          width: "100%",
          borderCollapse: "collapse" as const,
          border: `1px solid ${BORDER}`,
          backgroundColor: SURFACE,
        }}
      >
        <tbody>
          {digest.onsale.map((item) => {
            const when = formatInstantInZone(item.onsaleStart, digest.timezone);
            const place = [item.venueName, item.cityLabel]
              .filter(Boolean)
              .join(" · ");

            return (
              <tr key={item.tmEventId}>
                <td
                  style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${BORDER}`,
                    fontFamily: SANS,
                    fontSize: "13px",
                    color: TEXT,
                    backgroundColor: SURFACE,
                  }}
                >
                  {item.url ? (
                    <Link
                      href={item.url}
                      style={{ color: TEXT, textDecoration: "none" }}
                    >
                      {item.name}
                    </Link>
                  ) : (
                    item.name
                  )}
                  <span style={{ color: MUTED }}>
                    {place ? ` — ${place}` : ""} · {item.dateLabel}
                  </span>
                  {/* The onsale time is the actionable half, so it gets its own
                      line rather than trailing a long venue string. */}
                  <span
                    style={{
                      display: "block",
                      marginTop: "3px",
                      fontFamily: MONO,
                      fontSize: "12px",
                      color: ACCENT,
                    }}
                  >
                    {when ? `on sale ${when}` : "on sale date announced"}
                  </span>
                  {item.matchedArtists.length > 0 ? (
                    <span
                      style={{
                        display: "block",
                        marginTop: "2px",
                        fontFamily: SANS,
                        fontSize: "12px",
                        color: FAINT,
                      }}
                    >
                      because you follow {item.matchedArtists.join(", ")}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

/**
 * Shown when the list below it was not filtered by anything.
 *
 * Deliberately stated in the first person plural and up front, above the shows,
 * because the alternative — quietly sending an unfiltered list under a promise of
 * filtering — reads as the filtering being broken. It also cannot claim these are
 * the *notable* shows: Ticketmaster exposes no popularity or listing-count signal
 * (see genre-ranking.ts for the same problem), so "everything listed" is the only
 * true description available.
 */
function UnfilteredNotice({ digest }: { digest: Digest }) {
  return (
    <Section
      style={{
        border: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${ACCENT}`,
        backgroundColor: SURFACE,
        padding: "14px 16px",
        marginBottom: "16px",
      }}
    >
      <Text
        style={{
          margin: 0,
          fontFamily: SANS,
          fontSize: "13px",
          lineHeight: "1.5",
          color: MUTED,
        }}
      >
        You haven&apos;t told us what you listen to yet, so this is everything
        listed in {digest.cities.join(", ") || "your cities"} — not a filtered
        selection.{" "}
        <Link
          href={appLink(digest.siteUrl, "/app/subscriptions")}
          style={{ color: ACCENT, textDecoration: "underline" }}
        >
          Pick your genres
        </Link>{" "}
        and next Friday&apos;s email gets much shorter.
      </Text>
    </Section>
  );
}

function EmptyWeek({ digest }: { digest: Digest }) {
  return (
    <Section
      style={{
        border: `1px dashed ${BORDER}`,
        backgroundColor: SURFACE,
        padding: "24px",
      }}
    >
      <Text
        style={{ margin: 0, fontFamily: SANS, fontSize: "15px", color: TEXT }}
      >
        Nothing matched this week.
      </Text>
      <Text
        style={{
          margin: "8px 0 0",
          fontFamily: SANS,
          fontSize: "13px",
          color: MUTED,
        }}
      >
        {digest.cities.length === 0
          ? "You haven't followed any cities yet."
          : `No listed shows in ${digest.cities.join(", ")} matched your genres or artists between ${digest.windowLabel}.`}{" "}
        <Link
          href={appLink(digest.siteUrl, "/app/subscriptions")}
          style={{ color: ACCENT, textDecoration: "underline" }}
        >
          Widen your filters
        </Link>{" "}
        or{" "}
        <Link
          href={appLink(digest.siteUrl, "/app/subscriptions#screenshots")}
          style={{ color: ACCENT, textDecoration: "underline" }}
        >
          feed it a flyer
        </Link>
        .
      </Text>
    </Section>
  );
}

function Footer({ digest }: { digest: Digest }) {
  const linkStyle = {
    color: MUTED,
    textDecoration: "underline",
  } as const;

  return (
    <Section style={{ marginTop: "28px", borderTop: `1px solid ${BORDER}`, paddingTop: "16px" }}>
      <Text
        style={{
          margin: 0,
          fontFamily: SANS,
          fontSize: "12px",
          lineHeight: "1.6",
          color: MUTED,
        }}
      >
        <Link href={digest.previewUrl} style={linkStyle}>
          View in browser
        </Link>
        <span style={{ color: FAINT }}> · </span>
        <Link href={appLink(digest.siteUrl, "/app/subscriptions")} style={linkStyle}>
          Change what you follow
        </Link>
        <span style={{ color: FAINT }}> · </span>
        <Link href={`${digest.siteUrl}/privacy`} style={linkStyle}>
          Privacy
        </Link>
        <span style={{ color: FAINT }}> · </span>
        {/* Repeated in the List-Unsubscribe headers; kept in the body because
            clients that do not surface those headers still need a way out. */}
        <Link href={digest.unsubscribeUrl} style={linkStyle}>
          Unsubscribe
        </Link>
      </Text>

      <Text
        style={{
          margin: "12px 0 0",
          fontFamily: SANS,
          fontSize: "11px",
          lineHeight: "1.6",
          color: FAINT,
        }}
      >
        Event listings, artist pages and images via Ticketmaster. Video links and
        thumbnails via YouTube (
        <Link
          href="https://www.youtube.com/t/terms"
          style={{ color: FAINT, textDecoration: "underline" }}
        >
          YouTube Terms of Service
        </Link>
        ). Billing order is not published by Ticketmaster, so acts we cannot
        identify from the event title are listed as sharing the bill rather than
        as opening acts.
      </Text>
    </Section>
  );
}

/**
 * A YouTube or Spotify link with its official mark, for email.
 *
 * The label is always rendered as text beside the icon, not replaced by it.
 * Images are blocked in a large share of inboxes, and a bare icon that fails to
 * load leaves an unexplained gap where a link should be — so the icon is
 * decorative (`alt=""`) and the word carries the meaning.
 *
 * See components/service-icon.tsx for why the asset must be the unmodified
 * official one rather than something drawn in this site's pixel style.
 */
function EmailServiceLink({
  service,
  href,
  siteUrl,
}: {
  service: LinkService;
  href: string;
  siteUrl: string;
}) {
  return (
    <Link href={href} style={{ color: MUTED, textDecoration: "underline" }}>
      <Img
        src={serviceIconUrl(service, siteUrl)}
        alt=""
        width={12}
        height={12}
        style={{
          display: "inline-block",
          border: 0,
          verticalAlign: "middle",
          marginRight: "4px",
        }}
      />
      {serviceLabel(service)}
    </Link>
  );
}

function headlinerName(event: DigestEvent): string | null {
  return event.performers.find((p) => p.isHeadliner)?.name ?? null;
}

/**
 * Deterministic block pattern, seeded so the same recipient always gets the same
 * strip — and so server render and any later re-render agree.
 */
function pixelPattern(seed: string, count: number): (string | null)[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const out: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const value = Math.abs(h) / 2147483647;
    out.push(value < 0.4 ? PIXELS[Math.floor(value * 10) % PIXELS.length] : null);
  }
  return out;
}
