import { Card } from "@/components/ui";
import { disconnectSpotify } from "./actions";
import { IMPORT_INTERVAL_DAYS } from "@/lib/spotify/import";

export type SpotifyState = {
  connected: boolean;
  lastImportedAt: string | null;
  lastArtistCount: number | null;
  needsReconnect: boolean;
};

/**
 * Connect Spotify, or say what it last did.
 *
 * The copy is deliberately specific about how little is asked for. "Connect your
 * Spotify" reads, to anybody who has met an OAuth screen before, as "hand over your
 * library" — so the card states the scope, states that images and genres are not
 * touched, and states the interval. All three are true and all three are the reason
 * somebody would say yes.
 */
export function SpotifyCard({ state }: { state: SpotifyState }) {
  return (
    <Card className="p-5">
      {state.connected ? (
        <>
          <p className="flex flex-wrap items-baseline gap-2 text-sm text-text">
            <span>Spotify is connected.</span>
            {state.lastArtistCount != null && state.lastImportedAt ? (
              <span className="text-muted">
                Last import added {state.lastArtistCount} artist
                {state.lastArtistCount === 1 ? "" : "s"} on{" "}
                {new Date(state.lastImportedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
                .
              </span>
            ) : (
              <span className="text-muted">The first import is on its way.</span>
            )}
          </p>

          {state.needsReconnect ? (
            <p className="mt-3 border border-warn/40 bg-surface-raised px-3 py-2 text-xs text-warn">
              Spotify has revoked the connection — most likely from its own
              settings page. Reconnect to start importing again. Nothing was lost:
              the artists already imported are still followed.
            </p>
          ) : (
            <p className="mt-2 text-xs text-faint">
              Your top artists are re-read every {IMPORT_INTERVAL_DAYS} days.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {state.needsReconnect ? (
              <a
                href="/api/spotify/connect"
                className="border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
              >
                Reconnect Spotify
              </a>
            ) : null}
            {/* A form so this is a POST: a disconnect behind a GET would be
                triggerable by any link or prefetch. */}
            <form action={disconnectSpotify}>
              <button
                type="submit"
                className="border border-border-strong px-3 py-1.5 text-xs text-muted hover:border-danger hover:text-danger"
              >
                Disconnect
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-text">
            Connect Spotify to follow your top 50 artists automatically.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-muted">
            <li>
              It asks for one permission, <span className="text-text">user-top-read</span>
              , and nothing else. It cannot see your playlists.
            </li>
            <li>
              It reads artist names only — no images, no genre analysis, no listening
              history stored.
            </li>
            <li>
              It re-reads them every {IMPORT_INTERVAL_DAYS} days, and you can
              disconnect whenever.
            </li>
          </ul>
          <div className="mt-4">
            <a
              href="/api/spotify/connect"
              className="inline-flex items-center gap-2 border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
            >
              Connect Spotify
            </a>
          </div>
          {/* Plain text, not a ServiceLink: their guidelines require the mark to
              link to Spotify, and this link goes to our own Feeds page. */}
          <p className="mt-3 text-xs text-faint">
            Prefer not to connect anything? The{" "}
            <a className="text-accent underline" href="/app/feeds">
              screenshot reader
            </a>{" "}
            does the same job from a picture of your library.
          </p>
        </>
      )}
    </Card>
  );
}
