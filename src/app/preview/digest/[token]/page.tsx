import { notFound } from "next/navigation";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyToken } from "@/lib/tokens";
import { buildDigest } from "@/lib/digest/build";
import { digestWindow, localDateString } from "@/lib/time";
import { Card, EmptyState, ButtonLink } from "@/components/ui";
import { PixelDot, PixelMosaic, PixelRule } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import type { Profile } from "@/lib/db";

export const metadata = {
  title: "Your week — likelylist",
  // An inbox link should not end up in a search index.
  robots: { index: false, follow: false },
};

/**
 * Web version of the digest.
 *
 * Reached from "View in browser" and from the "view all N shows" link, both of
 * which are opened from an email with no session — so the link carries a signed
 * token rather than relying on a cookie. Unlike the email this shows every match,
 * which is the whole reason the email can afford to cap itself.
 */
export default async function DigestPreviewPage({
  params,
}: PageProps<"/preview/digest/[token]">) {
  const { token } = await params;
  const env = readEnv();

  const verified = await verifyToken(env.unsubscribeHmacSecret, "preview", token);
  if (!verified) notFound();

  const supabase = createAdminClient(env);

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", verified.userId)
    .maybeSingle<Pick<Profile, "timezone">>();
  if (!profile) notFound();

  const window = digestWindow(new Date(), profile.timezone);
  const digest = await buildDigest(supabase, env, verified.userId, {
    startDate: window.startDate,
    endDate: window.endDate,
    // The reader is waiting on this render; YouTube enrichment costs an API call
    // per artist and the email already carries those links.
    skipEnrichment: true,
  });
  if (!digest) notFound();

  const today = localDateString(profile.timezone, new Date());

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <header className="flex items-start justify-between gap-6">
        <div>
          <Wordmark />
          <p className="label-pixel mt-4">{digest.windowLabel}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {digest.totalEventCount === 0
              ? "Nothing matched this week"
              : `${digest.totalEventCount} show${digest.totalEventCount === 1 ? "" : "s"} worth knowing about`}
          </h1>
          {digest.cities.length > 0 ? (
            <p className="mt-2 text-sm text-muted">{digest.cities.join(" · ")}</p>
          ) : null}
        </div>
        <PixelMosaic
          seed={digest.userId}
          cols={6}
          rows={6}
          cell={9}
          density={0.32}
          className="hidden sm:grid"
        />
      </header>

      <PixelRule className="mt-8" />

      {digest.events.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="no matches">
            {digest.cities.length === 0
              ? "You haven't followed any cities yet."
              : "No listed shows matched your genres or artists this week."}
            <div className="mt-4">
              <ButtonLink href={`${digest.siteUrl}/app/subscriptions`} variant="outline">
                Widen your filters
              </ButtonLink>
            </div>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {digest.events.map((event) => (
            <li key={event.tmEventId}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-accent">
                      {event.dateLabel}
                      {event.timeLabel ? ` · ${event.timeLabel}` : ""}
                    </p>
                    <h2 className="mt-1.5 text-base font-semibold tracking-tight">
                      {event.url ? (
                        <a
                          href={event.url}
                          className="hover:underline"
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          {event.name}
                        </a>
                      ) : (
                        event.name
                      )}
                    </h2>
                    <p className="mt-1.5 text-sm text-muted">
                      {[event.venueName, event.cityLabel]
                        .filter(Boolean)
                        .join(" · ")}
                      {event.genreName ? ` · ${event.genreName}` : ""}
                    </p>
                    {event.matchedArtists.length > 0 ? (
                      <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-pixel-3">
                        <PixelDot size={6} color="var(--pixel-3)" />
                        because you follow {event.matchedArtists.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  {event.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- hotlinked from Ticketmaster's CDN; see next.config.ts
                    <img
                      src={event.imageUrl}
                      alt={`Promotional image for ${event.name}`}
                      width={160}
                      height={90}
                      className="border border-border"
                    />
                  ) : null}
                </div>

                <ul className="mt-4 divide-y divide-border border-t border-border">
                  {event.performers.map((performer) => (
                    <li
                      key={performer.name}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
                    >
                      <span className="text-text">
                        {performer.tmUrl ? (
                          <a
                            href={performer.tmUrl}
                            className="hover:underline"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            {performer.name}
                          </a>
                        ) : (
                          performer.name
                        )}
                      </span>
                      <span className="label-pixel">
                        {performer.isHeadliner
                          ? "headliner"
                          : event.performers.some((p) => p.isHeadliner)
                            ? "same bill"
                            : "on the bill"}
                      </span>
                      <span className="ml-auto flex gap-3 text-xs">
                        <a
                          href={performer.youtubeUrl}
                          className="text-muted underline hover:text-text"
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          YouTube
                        </a>
                        <a
                          href={performer.spotifyUrl}
                          className="text-muted underline hover:text-text"
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          Spotify
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-12 border-t border-border pt-6 text-xs leading-relaxed text-faint">
        <p>
          Rebuilt live on {today} from the same data as your email, so it can
          differ slightly if listings changed since Friday.
        </p>
        <p className="mt-2">
          Event listings, artist pages and images via Ticketmaster. Video links
          via YouTube (
          <a
            className="underline hover:text-muted"
            href="https://www.youtube.com/t/terms"
            rel="noreferrer noopener"
            target="_blank"
          >
            YouTube Terms of Service
          </a>
          ). Ticketmaster does not publish billing order, so acts that cannot be
          identified from the event title are listed as sharing the bill.
        </p>
        <p className="mt-3">
          <a className="underline hover:text-muted" href={digest.unsubscribeUrl}>
            Unsubscribe from the weekly email
          </a>
        </p>
      </footer>
    </main>
  );
}
