import { notFound } from "next/navigation";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { PREVIEW_TOKEN_MAX_AGE_MS, verifyToken } from "@/lib/tokens";
import { buildDigest } from "@/lib/digest/build";
import { digestWindow, formatInstantInZone, localDateString } from "@/lib/time";
import { Card, EmptyState, ButtonLink } from "@/components/ui";
import { PixelDot, PixelMosaic, PixelRule } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import type { Profile } from "@/lib/db";

export const metadata = {
  title: "Your week",
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

  const verified = await verifyToken(env.unsubscribeHmacSecret, "preview", token, {
    maxAgeMs: PREVIEW_TOKEN_MAX_AGE_MS,
  });

  if (!verified) {
    // Verified a second time without the age limit purely to tell "expired"
    // apart from "forged". An old inbox link deserves an explanation and a way
    // back in, not a bare 404.
    const expired = await verifyToken(
      env.unsubscribeHmacSecret,
      "preview",
      token,
    );
    if (!expired) notFound();
    return <ExpiredLink siteUrl={env.siteUrl} />;
  }

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

      {/* Same disclosure the email carries — this page is the email's own "view in
          browser", so it cannot present an unfiltered list as a filtered one
          either. */}
      {digest.fallbackReason === "no_preferences" && digest.events.length > 0 ? (
        <div className="mt-8 border border-border-strong/70 border-l-2 border-l-accent bg-surface/50 p-4">
          <p className="text-sm leading-relaxed text-muted">
            You haven&apos;t told us what you listen to yet, so this is
            everything listed in{" "}
            {digest.cities.join(", ") || "your cities"} — not a filtered
            selection.{" "}
            <a
              className="text-accent underline"
              href={`${digest.siteUrl}/login?next=${encodeURIComponent("/app/subscriptions")}`}
            >
              Pick your genres
            </a>{" "}
            and next Wednesday&apos;s email gets much shorter.
          </p>
        </div>
      ) : null}

      {/* The email caps this section at MAX_ONSALE_EVENTS; here every drop in the
          window is listed, the same way the show list is. */}
      {digest.onsale.length > 0 ? (
        <section className="mt-8">
          <p className="label-pixel">on sale this week</p>
          <ul className="mt-3 divide-y divide-border border border-border">
            {digest.onsale.map((item) => {
              const when = formatInstantInZone(item.onsaleStart, digest.timezone);
              const place = [item.venueName, item.cityLabel]
                .filter(Boolean)
                .join(" · ");

              return (
                <li key={item.tmEventId} className="px-4 py-3">
                  <p className="text-sm text-text">
                    {item.url ? (
                      <a className="hover:underline" href={item.url}>
                        {item.name}
                      </a>
                    ) : (
                      item.name
                    )}
                    <span className="text-muted">
                      {place ? ` — ${place}` : ""} · {item.dateLabel}
                    </span>
                  </p>
                  <p className="mt-1 font-mono text-xs text-accent">
                    {when ? `on sale ${when}` : "on sale date announced"}
                  </p>
                  {item.matchedArtists.length > 0 ? (
                    <p className="mt-1 text-xs text-faint">
                      because you follow {item.matchedArtists.join(", ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {digest.events.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="no matches">
            {digest.cities.length === 0
              ? "You haven't followed any cities yet."
              : "No listed shows matched your genres or artists this week."}
            <div className="mt-4">
              <ButtonLink
                href={`${digest.siteUrl}/login?next=${encodeURIComponent("/app/subscriptions")}`}
                variant="outline"
              >
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
          differ slightly if listings changed since the run.
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
        <p className="mt-3 flex flex-wrap gap-4">
          <a className="underline hover:text-muted" href="/privacy">
            Privacy
          </a>
          <a className="underline hover:text-muted" href={digest.unsubscribeUrl}>
            Unsubscribe from the weekly email
          </a>
        </p>
      </footer>
    </main>
  );
}

/**
 * Shown when the signature is good but the link is older than the token window.
 *
 * These links expose which cities and artists someone follows, so they stop
 * working after a week — a forwarded or leaked email should not stay a readable
 * window into an account indefinitely.
 */
function ExpiredLink({ siteUrl }: { siteUrl: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <Wordmark href={null} />
      <PixelRule className="mt-6" />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">
        This link has expired
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Links from the weekly email stop working after seven days, so an old
        message can&apos;t keep showing what you follow. Sign in to see this
        week&apos;s picks instead.
      </p>
      <div className="mt-6">
        <ButtonLink href={`${siteUrl}/app`}>Open likelylist</ButtonLink>
      </div>
    </main>
  );
}
