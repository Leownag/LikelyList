"use client";

import type { LinkService } from "@/components/service-icon";
import { ASSET_SRC } from "@/components/service-icon";

/**
 * A brand mark that disappears rather than leaving a broken-image glyph.
 *
 * Its own client component for one reason: hiding a failed load needs an `onError`
 * handler, and a function prop cannot cross a server-component boundary. Inline in
 * ServiceLink it threw "Event handlers cannot be passed to Client Component props" on
 * every server-rendered page that lists a lineup — /app/feed, /app/pinned and the
 * Spotify card. /explore was unaffected only because that whole subtree is client, which
 * is why the error looked page-specific rather than like the shared bug it was.
 *
 * service-icon.tsx cannot simply be marked "use client" instead: the digest email calls
 * serviceIconUrl() while rendering on the server, and a "use client" module's exports
 * arrive there as client references rather than callable functions.
 */
export function ServiceIconImg({
  service,
  size = 14,
  className = "",
}: {
  service: LinkService;
  /**
   * Pixels, square. 14 beside body text; 21 is Spotify's documented minimum for their
   * icon as a standalone mark, which is what the connect button uses it as.
   */
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ASSET_SRC[service]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      // Kept square and unscaled; the brand guidelines forbid distorting the mark.
      style={{ objectFit: "contain" }}
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}
