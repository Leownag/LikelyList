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
          <Header windowLabel={digest.windowLabel} cities={digest.cities} />

          <PixelStrip seed={digest.userId} />

          {shown.length === 0 ? (
            <EmptyWeek digest={digest} />
          ) : (
            shown.map((event) => (
              <EventCard key={event.tmEventId} event={event} />
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
}: {
  windowLabel: string;
  cities: string[];
}) {
  return (
    <Section style={{ paddingBottom: "16px" }}>
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

function EventCard({ event }: { event: DigestEvent }) {
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
            <PerformerRow performer={headliner} label="headliner" />
          ) : null}
          {listed.map((performer) => (
            <PerformerRow
              key={performer.name}
              performer={performer}
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

function PerformerRow({
  performer,
  label,
}: {
  performer: DigestPerformer;
  label: string;
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
        marginTop: "12px",
        borderTop: `1px solid ${BORDER}`,
      }}
    >
      <tbody>
        <tr>
          <td style={{ paddingTop: "10px", verticalAlign: "top" as const }}>
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              border={0}
              style={{ borderCollapse: "collapse" as const }}
            >
              <tbody>
                <tr>
                  {performer.imageUrl ? (
                    <td
                      width={48}
                      style={{ paddingRight: "10px", verticalAlign: "top" as const }}
                    >
                      <Img
                        src={performer.imageUrl}
                        alt={performer.name}
                        width={48}
                        height={32}
                        style={{
                          display: "block",
                          border: 0,
                          fontFamily: SANS,
                          fontSize: "10px",
                          color: FAINT,
                          backgroundColor: BG,
                        }}
                      />
                    </td>
                  ) : null}
                  <td style={{ verticalAlign: "top" as const }}>
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
                          letterSpacing: "0.08em",
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
                        margin: "4px 0 0",
                        fontFamily: SANS,
                        fontSize: "12px",
                        color: MUTED,
                      }}
                    >
                      <Link
                        href={performer.youtubeUrl}
                        style={{ color: MUTED, textDecoration: "underline" }}
                      >
                        YouTube
                      </Link>
                      <span style={{ color: FAINT }}> · </span>
                      <Link
                        href={performer.spotifyUrl}
                        style={{ color: MUTED, textDecoration: "underline" }}
                      >
                        Spotify
                      </Link>
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
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
          href={`${digest.siteUrl}/app/subscriptions`}
          style={{ color: ACCENT, textDecoration: "underline" }}
        >
          Widen your filters
        </Link>{" "}
        or{" "}
        <Link
          href={`${digest.siteUrl}/app/feeds`}
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
        <Link href={`${digest.siteUrl}/app/subscriptions`} style={linkStyle}>
          Change what you follow
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
