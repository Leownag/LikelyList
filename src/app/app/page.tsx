import Link from "next/link";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Card, EmptyState, SectionHeading, ButtonLink, Notice } from "@/components/ui";
import { PixelDot, PixelMosaic } from "@/components/pixel";
import { nextWeekdayAt } from "@/lib/time";
import type { City, Genre, GenrePref, Subscription } from "@/lib/db";
import { DigestPreview } from "./digest-preview";

export const metadata = { title: "Overview — likelylist" };

/** Friday, in the user's own timezone. */
const DIGEST_WEEKDAY = 5;

export default async function OverviewPage() {
  const { userId, profile } = await requireProfile();
  const supabase = await createClient();

  // Reference tables are read separately and joined in code rather than with
  // PostgREST embeds. Without generated database types, supabase-js types an
  // embedded to-one relation as an array, and the cast needed to fix that would
  // hide real shape mistakes.
  const [subsResult, prefsResult, feedsResult, citiesResult, genresResult] =
    await Promise.all([
      supabase
        .from("subscriptions")
        .select("id, city_id")
        .eq("user_id", userId)
        .order("id"),
      supabase
        .from("genre_prefs")
        .select("id, genre_id, weight, source")
        .eq("user_id", userId)
        .order("weight", { ascending: false }),
      supabase
        .from("feeds")
        .select("id, status, not_music_related, applied_at", { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("cities").select("id, name, state_code"),
      supabase.from("genres").select("id, name"),
    ]);

  const cityById = new Map(
    ((citiesResult.data ?? []) as Pick<City, "id" | "name" | "state_code">[]).map(
      (city) => [city.id, city],
    ),
  );
  const genreById = new Map(
    ((genresResult.data ?? []) as Pick<Genre, "id" | "name">[]).map((genre) => [
      genre.id,
      genre,
    ]),
  );

  const subscriptions = ((subsResult.data ?? []) as Pick<
    Subscription,
    "id" | "city_id"
  >[]).map((subscription) => ({
    ...subscription,
    city: cityById.get(subscription.city_id) ?? null,
  }));

  const genrePrefs = ((prefsResult.data ?? []) as Pick<
    GenrePref,
    "id" | "genre_id" | "weight" | "source"
  >[])
    // Zero-weight rows are opt-out markers rather than followed genres.
    .filter((pref) => pref.weight > 0)
    .map((pref) => ({
      ...pref,
      genre: genreById.get(pref.genre_id) ?? null,
    }));

  const feedCount = feedsResult.count ?? 0;
  const pendingFeeds = (feedsResult.data ?? []).filter(
    (feed) => feed.status === "done" && !feed.applied_at && !feed.not_music_related,
  ).length;

  const nextSend = nextWeekdayAt(
    new Date(),
    profile.timezone,
    DIGEST_WEEKDAY,
    profile.digest_send_hour,
  );
  const nextSendLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: profile.timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(nextSend);

  const ready = subscriptions.length > 0 && genrePrefs.length > 0;

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="label-pixel">next digest</p>
            <p className="mt-2 font-mono text-lg">{nextSendLabel}</p>
            <p className="mt-2 max-w-md text-sm text-muted">
              Delivery is scheduled in your own timezone, so it stays in the
              morning year-round. The exact minute drifts a little — Cloudflare
              spreads scheduled work across the hour.
            </p>
          </div>
          <PixelMosaic
            seed={`likelylist-${userId}`}
            cols={6}
            rows={6}
            cell={9}
            density={0.32}
            className="hidden sm:grid"
          />
        </div>

        {!profile.digest_enabled ? (
          <div className="mt-5">
            <Notice tone="warn">
              Your digest is currently paused. Turn it back on in{" "}
              <Link className="text-accent underline" href="/app/settings">
                Settings
              </Link>
              .
            </Notice>
          </div>
        ) : null}

        {!ready ? (
          <div className="mt-5">
            <Notice tone="warn">
              {subscriptions.length === 0 && genrePrefs.length === 0
                ? "Pick at least one city and one genre and the first digest will go out this Friday."
                : subscriptions.length === 0
                  ? "You have genres but no cities yet — add a city to start receiving listings."
                  : "You have cities but no genres yet — add a genre so there is something to filter by."}{" "}
              <Link className="text-accent underline" href="/app/subscriptions">
                Set that up
              </Link>
              .
            </Notice>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <Card className="p-5">
          <SectionHeading hint="Queried once per city, then filtered by your genres.">
            Cities
          </SectionHeading>
          {subscriptions.length === 0 ? (
            <EmptyState title="none yet">
              <ButtonLink href="/app/subscriptions" variant="outline">
                Add a city
              </ButtonLink>
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {subscriptions.map((subscription) => (
                <li
                  key={subscription.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <PixelDot size={6} />
                  <span>{subscription.city?.name ?? "Unknown city"}</span>
                  {subscription.city?.state_code ? (
                    <span className="text-faint">
                      {subscription.city.state_code}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeading hint="Genres you chose, plus any inferred from your feeds.">
            Genres
          </SectionHeading>
          {genrePrefs.length === 0 ? (
            <EmptyState title="none yet">
              <ButtonLink href="/app/subscriptions" variant="outline">
                Add a genre
              </ButtonLink>
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {genrePrefs.map((pref) => (
                <li key={pref.id} className="flex items-center gap-2 text-sm">
                  <PixelDot
                    size={6}
                    color={
                      pref.source === "feed"
                        ? "var(--pixel-3)"
                        : "var(--pixel-1)"
                    }
                  />
                  <span>{pref.genre?.name ?? "Unknown genre"}</span>
                  {pref.source === "feed" ? (
                    <span className="label-pixel">from feeds</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <SectionHeading hint="Builds this week's digest from live data. Reports the rendered email size, which is the one thing you can't check by eye.">
          Try it now
        </SectionHeading>
        <Card className="p-5">
          <DigestPreview />
        </Card>
      </section>

      <section>
        <SectionHeading hint="Screenshots you've fed in, and what was learned from them.">
          Feeds
        </SectionHeading>
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="text-sm">
            <p>
              <span className="font-mono text-lg">{feedCount}</span>{" "}
              <span className="text-muted">
                screenshot{feedCount === 1 ? "" : "s"} processed
              </span>
            </p>
            {pendingFeeds > 0 ? (
              <p className="mt-1 text-xs text-pixel-3">
                {pendingFeeds} waiting for you to confirm what was read.
              </p>
            ) : null}
          </div>
          <ButtonLink href="/app/feeds" variant="outline">
            Add a feed
          </ButtonLink>
        </Card>
      </section>
    </div>
  );
}
