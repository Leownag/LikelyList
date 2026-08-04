import Link from "next/link";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/supabase/server";
import { DEV_MODE_COOKIE, isDevMode } from "@/lib/dev-mode";
import { readEnv } from "@/lib/env";
import { DevSendDigest } from "@/components/dev-send-digest";
import { Wordmark } from "@/components/wordmark";
import { ButtonLink } from "@/components/ui";
import { PixelRule } from "@/components/pixel";
import { LanguageSwitch } from "@/components/language-switch";
import { getT } from "@/lib/i18n/server";
import { SpotifyConnectButton } from "@/components/spotify-connect";
import { loadSpotifyState } from "@/lib/spotify/state";

const NAV = [
  { href: "/app", label: "nav.overview" },
  // My feed before the settings that shape it: the reader came to see shows, not to
  // administer a filter.
  { href: "/app/feed", label: "nav.feed" },
  { href: "/app/pinned", label: "nav.pinned" },
  // Cities, genres, artists and screenshot import are one page: they are four ways of
  // setting the same filter, and having the screenshot one elsewhere meant an upload's
  // result appeared on a screen the reader had just left.
  { href: "/app/subscriptions", label: "nav.follow" },
  { href: "/app/settings", label: "nav.settings" },
] as const;

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  // Every protected page re-verifies on the server. There is no proxy to trust
  // here in any case — refresh happens in the browser (see session-sync.tsx and
  // the README's note on opennextjs-cloudflare#962).
  const { userId, profile } = await requireProfile();

  // One extra read per /app page render, and worth it: the offer is only useful to
  // someone who has not taken it, so the header cannot know whether to show it without
  // asking. Null means this deployment has no Spotify app configured at all.
  const spotify = await loadSpotifyState(userId);
  const t = await getT();
  const offerSpotify = spotify !== null && (!spotify.connected || spotify.needsReconnect);

  // Gated on the server so the widget is not even in the markup for a normal reader.
  const devMode = await isDevMode({
    cookieValue: (await cookies()).get(DEV_MODE_COOKIE)?.value,
    secret: readEnv().cronSecret,
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Wordmark />
        <div className="flex items-center gap-4">
          {/* Top right on every page, in the same corner the landing page puts it.
              It was one item in the nav row below, which put the only link that
              leaves /app in the middle of a list of places inside it. */}
          <ButtonLink href="/explore" variant="ghost">
            {t("common.explore")}
          </ButtonLink>

          {/* Disappears the moment it is taken, so it is a prompt rather than
              furniture. Hidden on narrow screens, where the header has no room for it
              and the same button sits in the Artists section anyway. */}
          {offerSpotify ? (
            <SpotifyConnectButton
              reconnect={spotify.needsReconnect}
              className="hidden sm:inline-flex"
            />
          ) : null}

          <LanguageSwitch />
          <span className="hidden text-xs text-faint sm:inline">
            {profile.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-xs text-muted underline hover:text-text"
            >
              {t("shell.signOut")}
            </button>
          </form>
        </div>
      </header>

      <nav className="mt-8 flex flex-wrap gap-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="border border-transparent px-3 py-1.5 text-sm text-muted hover:border-border hover:text-text"
          >
            {t(item.label)}
          </Link>
        ))}
      </nav>

      <PixelRule className="mt-3" />

      <main className="mt-8 flex-1">{children}</main>

      {devMode ? <DevSendDigest /> : null}
    </div>
  );
}
