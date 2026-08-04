import { ServiceIconImg } from "@/components/service-icon-img";
import { getT } from "@/lib/i18n/server";

/**
 * "Connect with Spotify", to Spotify's rules rather than to ours.
 *
 * One component for both places it appears — the /app header and the Artists section —
 * because two hand-styled versions of a button governed by someone else's brand
 * guidelines is two chances to break them.
 *
 * What those guidelines require, and what each choice here is:
 *
 *   - The official icon, unmodified. It is the green Icon from Spotify's kit, rendered
 *     from public/brand/spotify.svg with no recolouring and no restyling into this
 *     site's pixel look. It hides itself if the asset is missing, so the button reads
 *     correctly either way.
 *   - Never below 21px. Hence the explicit size, rather than the 14px used beside body
 *     text elsewhere.
 *   - Clear space around the mark. `gap-2.5` plus `px-3.5` keeps roughly half the
 *     icon's height clear on every side.
 *   - "Connect with Spotify" verbatim. Their wording, and it says what happens.
 *   - Nothing may imply endorsement. So this deliberately does NOT use the site's
 *     accent colour, which is reserved for our own primary actions — Spotify's own
 *     black and green read as a third-party affordance, which is exactly what it is.
 *     The hex values are hardcoded rather than themed for the same reason: a brand
 *     colour that follows our palette is a modified brand colour.
 */
export async function SpotifyConnectButton({
  reconnect = false,
  className = "",
}: {
  reconnect?: boolean;
  className?: string;
}) {
  // Async, so it reads the locale itself rather than taking a label prop from each of its
  // three call sites. All three are server components; a client one would have to pass the
  // string in instead.
  const t = await getT();

  return (
    <a
      href="/api/spotify/connect"
      className={`inline-flex items-center gap-2.5 border border-[#1ed760]/50 bg-[#191414] px-3.5 py-2 text-xs font-semibold text-white hover:border-[#1ed760] ${className}`}
    >
      <ServiceIconImg service="spotify" size={21} />
      {reconnect ? t("common.reconnectSpotify") : t("common.connectSpotify")}
    </a>
  );
}
