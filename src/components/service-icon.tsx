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

export type LinkService = "youtube" | "spotify";

const ASSETS: Record<LinkService, { src: string; label: string; alt: string }> = {
  youtube: {
    // Official mark, unmodified, from YouTube's brand resources.
    src: "/brand/youtube.svg",
    label: "YouTube",
    alt: "YouTube",
  },
  spotify: {
    // Official mark, unmodified, from Spotify's design guidelines.
    src: "/brand/spotify.svg",
    label: "Spotify",
    alt: "Spotify",
  },
};

/**
 * Web version. Renders the icon beside its name, both inside one link.
 *
 * `onError` hides a missing asset rather than leaving a broken-image glyph, so the
 * link still reads correctly before the brand files are added.
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.src}
        alt=""
        aria-hidden="true"
        width={14}
        height={14}
        className="shrink-0"
        // Kept square and unscaled; the guidelines forbid distorting the mark.
        style={{ objectFit: "contain" }}
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
      <span>{asset.label}</span>
    </a>
  );
}

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
