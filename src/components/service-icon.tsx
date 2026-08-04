/**
 * YouTube and Spotify link marks.
 *
 * Read this before changing anything here.
 *
 * Both companies publish brand guidelines that permit — and for YouTube's API
 * effectively require — showing their mark when you link to their service using
 * their data. The permission is conditional, and the conditions are the reason
 * this file is not just an inline SVG someone drew:
 *
 *   - Use the OFFICIAL asset, unmodified. No recolouring, no rounding, no
 *     outlining, and specifically no redrawing it in this site's pixel style.
 *     A restyled logo is a modified logo, which is the one thing both sets of
 *     guidelines refuse.
 *   - Respect the minimum size and clear space in their guidelines.
 *   - The mark must link to their service.
 *   - Do not place it so it reads as a partnership or endorsement, and do not
 *     lock it up with the likelylist wordmark.
 *
 * So the assets are downloaded from the official brand pages and dropped into
 * `public/brand/` (see the README). Until they are present this renders the text
 * label alone, which is always compliant and never broken — an absent asset
 * degrades rather than showing a broken image.
 *
 * The text label stays visible next to the icon even when the asset exists. That
 * is not redundancy: in email, images are frequently blocked, and a bare icon with
 * nothing beside it becomes an unexplained gap.
 */

import { ServiceIconImg } from "@/components/service-icon-img";

export type LinkService = "youtube" | "spotify" | "google" | "apple";

const ASSETS: Record<LinkService, { src: string; label: string; alt: string }> = {
  youtube: {
    // Official mark, unmodified, from YouTube's brand resources — the full-colour icon
    // from the Digital set. A PNG because YouTube ships no SVG in that kit, and
    // resaving their artwork as one would be modifying it.
    src: "/brand/youtube.png",
    label: "YouTube",
    alt: "YouTube",
  },
  spotify: {
    // Official mark, unmodified — Primary_Logo_Green_RGB from Spotify's 2024 kit.
    src: "/brand/spotify.svg",
    label: "Spotify",
    alt: "Spotify",
  },
  // The calendar targets. Same rule as above and the same reason it is an asset rather
  // than a hand-drawn glyph: both companies publish a mark and forbid redrawing it, and
  // a pixel-art Apple logo would be a modified logo.
  // No asset shipped for either calendar target, so both render as their name alone —
  // which is always compliant. Google publishes a mark that could go here; Apple's
  // guidelines do not permit using their app icons in third-party UI at all, so that one
  // should stay text.
  google: {
    src: "/brand/google-calendar.svg",
    label: "Google Calendar",
    alt: "Google Calendar",
  },
  apple: {
    src: "/brand/apple-calendar.svg",
    label: "Apple Calendar",
    alt: "Apple Calendar",
  },
};

/**
 * Web version. Renders the icon beside its name, both inside one link.
 *
 * Server-renderable, which it has to be — /app/feed and /app/pinned are server
 * components. The mark itself hides on load failure and that needs a handler, so it
 * lives in its own client component (see ServiceIconImg).
 */
export function ServiceLink({
  service,
  href,
  className = "",
}: {
  service: LinkService;
  href: string;
  className?: string;
}) {
  const asset = ASSETS[service];

  return (
    <a
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      className={`inline-flex items-center gap-1.5 text-muted underline decoration-border-strong hover:text-text ${className}`}
    >
      <ServiceIconImg service={service} />
      <span>{asset.label}</span>
    </a>
  );
}

/**
 * Where each mark lives, for callers that need the path rather than a whole link.
 *
 * Exported so add-to-calendar can render the same asset with the same
 * degrade-to-nothing behaviour without duplicating the paths — three copies of a
 * brand asset path is how one of them ends up stale.
 */
export const ASSET_SRC: Record<LinkService, string> = {
  youtube: ASSETS.youtube.src,
  spotify: ASSETS.spotify.src,
  google: ASSETS.google.src,
  apple: ASSETS.apple.src,
};

/** Absolute URL for the same asset, which email needs. */
export function serviceIconUrl(service: LinkService, siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${ASSETS[service].src}`;
}

export function serviceLabel(service: LinkService): string {
  return ASSETS[service].label;
}

export function serviceAlt(service: LinkService): string {
  return ASSETS[service].alt;
}
