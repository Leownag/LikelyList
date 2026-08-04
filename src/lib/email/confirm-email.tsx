import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

/**
 * The double opt-in confirmation email.
 *
 * The only email likelylist will ever send to an address that has not been
 * confirmed, and it exists precisely so that no digest is ever sent to one. It
 * carries no images, no tracking and exactly one action.
 *
 * It says who asked and where from, because the recipient may not be the person
 * who typed their address in — that is the whole scenario double opt-in protects
 * against, and they deserve enough context to ignore it confidently.
 */

const BG = "#0a0a0a";
const SURFACE = "#141414";
const BORDER = "#262626";
const TEXT = "#fafafa";
const MUTED = "#a1a1aa";
const FAINT = "#71717a";
const ACCENT = "#e4ff3f";

const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export type ConfirmEmailProps = {
  confirmUrl: string;
  cityName: string | null;
  genreNames: string[];
  siteUrl: string;
};

/**
 * Rendered here rather than at the call site so the subscribe logic can stay a
 * plain `.ts` module with no JSX.
 */
export async function renderConfirmEmail(
  props: ConfirmEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  return {
    subject: "Confirm your weekly show digest",
    html: await render(<ConfirmEmail {...props} />),
    text: [
      "likelylist",
      "",
      `Someone asked for a weekly email of upcoming shows${
        props.cityName ? ` in ${props.cityName}` : ""
      } to be sent to this address.`,
      "Nothing will be sent until you confirm:",
      "",
      props.confirmUrl,
      "",
      "If that wasn't you, ignore this. No subscription exists, the link stops working in seven days, and we will not email this address again.",
      "",
      `Privacy: ${props.siteUrl}/privacy`,
    ].join("\n"),
  };
}

export function ConfirmEmail({
  confirmUrl,
  cityName,
  genreNames,
  siteUrl,
}: ConfirmEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Confirm your weekly show digest — one click, then nothing else</Preview>
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
            maxWidth: "560px",
            margin: "0 auto",
            padding: "28px 16px 40px",
            backgroundColor: BG,
          }}
        >
          <Text
            style={{
              margin: 0,
              fontFamily: MONO,
              fontSize: "15px",
              letterSpacing: "0.22em",
              textTransform: "uppercase" as const,
              color: TEXT,
            }}
          >
            likelylist
          </Text>

          <Text
            style={{
              margin: "24px 0 0",
              fontFamily: SANS,
              fontSize: "18px",
              fontWeight: 600,
              color: TEXT,
            }}
          >
            Confirm your weekly digest
          </Text>

          <Text
            style={{
              margin: "12px 0 0",
              fontFamily: SANS,
              fontSize: "14px",
              lineHeight: "1.6",
              color: MUTED,
            }}
          >
            Someone asked for a weekly email of upcoming shows
            {cityName ? ` in ${cityName}` : ""} to be sent to this address. Nothing
            will be sent until you confirm below.
          </Text>

          {genreNames.length > 0 ? (
            <Section
              style={{
                marginTop: "16px",
                border: `1px solid ${BORDER}`,
                backgroundColor: SURFACE,
                padding: "12px 14px",
              }}
            >
              <Text
                style={{
                  margin: 0,
                  fontFamily: MONO,
                  fontSize: "11px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase" as const,
                  color: FAINT,
                }}
              >
                genres requested
              </Text>
              <Text
                style={{
                  margin: "6px 0 0",
                  fontFamily: SANS,
                  fontSize: "13px",
                  color: TEXT,
                }}
              >
                {genreNames.join(", ")}
              </Text>
            </Section>
          ) : null}

          <Section style={{ marginTop: "24px" }}>
            <Link
              href={confirmUrl}
              style={{
                display: "inline-block",
                padding: "12px 20px",
                backgroundColor: ACCENT,
                color: BG,
                fontFamily: SANS,
                fontSize: "14px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Yes, send me the digest
            </Link>
          </Section>

          <Text
            style={{
              margin: "24px 0 0",
              fontFamily: SANS,
              fontSize: "13px",
              lineHeight: "1.6",
              color: MUTED,
            }}
          >
            If that wasn&apos;t you, ignore this — no subscription exists and this
            link stops working in seven days. We will not email this address again.
          </Text>

          <Text
            style={{
              margin: "20px 0 0",
              fontFamily: SANS,
              fontSize: "11px",
              lineHeight: "1.6",
              color: FAINT,
            }}
          >
            <Link
              href={`${siteUrl}/privacy`}
              style={{ color: FAINT, textDecoration: "underline" }}
            >
              Privacy
            </Link>
            {" · "}
            Event listings via Ticketmaster.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
