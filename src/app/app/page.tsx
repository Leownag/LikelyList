import Link from "next/link";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Card, EmptyState, SectionHeading, ButtonLink, Notice } from "@/components/ui";
import { PixelDot, PixelMosaic } from "@/components/pixel";
import { nextWeekdayAt } from "@/lib/time";
import type { City, Genre, GenrePref, Subscription } from "@/lib/db";
import { DigestPreview } from "./digest-preview";
import { getI18n, getT } from "@/lib/i18n/server";
import { SLOT, interleave } from "@/lib/i18n/interleave";

export async function generateMetadata() {
  return { title: (await getT())("title.overview") };
}

/** Friday, in the user's own timezone. */
const DIGEST_WEEKDAY = 5;

export default async function OverviewPage() {
  const { userId, profile } = await requireProfile();
  const { locale, t } = await getI18n();
  const supabase = await createClient();

  // Reference tables are read separately and joined in code rather than with
  // PostgREST embeds. Without generated database types, supabase-js types an
  // embedded to-one relation as an array, and the cast needed to fix that would
  // hide real shape mistakes.
  const [subsResult, prefsResult, feedsResult, citiesResult, genresResult] =
    await Promise.all([
      supabase
        .from("subscriptions")
        .select("id, city_id, place_name, state_code")
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
    "id" | "city_id" | "place_name" | "state_code"
  >[]).map((subscription) => ({
    ...subscription,
    // Since 0014 a subscription is a point with a label, and only the ones that came
    // from the curated picker still carry a city id. The label is what to show.
    city:
      (subscription.city_id !== null
        ? cityById.get(subscription.city_id)
        : null) ?? null,
    label:
      [subscription.place_name, subscription.state_code]
        .filter(Boolean)
        .join(", ") || null,
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
  // The reader's locale, not en-US: an English weekday inside Chinese body copy is the
  // most visible way a "translated" page announces that it is not.
  const nextSendLabel = new Intl.DateTimeFormat(locale, {
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
            <p className="label-pixel">{t("overview.next.label")}</p>
            <p className="mt-2 font-mono text-lg">{nextSendLabel}</p>
            <p className="mt-2 max-w-md text-sm text-muted">
              {t("overview.next.body")}
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
              {interleave(t("overview.paused", { settings: SLOT }), [
                <Link key="s" className="text-accent underline" href="/app/settings">
                  {t("nav.settings")}
                </Link>,
              ])}
            </Notice>
          </div>
        ) : null}

        {!ready ? (
          <div className="mt-5">
            <Notice tone="warn">
              {subscriptions.length === 0 && genrePrefs.length === 0
                ? t("overview.setup.neither")
                : subscriptions.length === 0
                  ? t("overview.setup.noCities")
                  : t("overview.setup.noGenres")}{" "}
              <Link className="text-accent underline" href="/app/subscriptions">
                {t("overview.setup.link")}
              </Link>
            </Notice>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <Card className="p-5">
          <SectionHeading hint={t("overview.cities.hint")}>
            {t("overview.cities.heading")}
          </SectionHeading>
          {subscriptions.length === 0 ? (
            <EmptyState title={t("common.noneYet")}>
              <ButtonLink href="/app/subscriptions" variant="outline">
                {t("overview.cities.add")}
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
                  {/* The stored label first: a subscription to a Census place has no
                      curated city row to read a name from. */}
                  <span>
                    {subscription.place_name ??
                      subscription.city?.name ??
                      t("overview.cities.unnamed")}
                  </span>
                  {subscription.state_code ?? subscription.city?.state_code ? (
                    <span className="text-faint">
                      {subscription.state_code ?? subscription.city?.state_code}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeading hint={t("overview.genres.hint")}>
            {t("overview.genres.heading")}
          </SectionHeading>
          {genrePrefs.length === 0 ? (
            <EmptyState title={t("common.noneYet")}>
              <ButtonLink href="/app/subscriptions" variant="outline">
                {t("overview.genres.add")}
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
                  <span>{pref.genre?.name ?? t("overview.genres.unknown")}</span>
                  {pref.source === "feed" ? (
                    <span className="label-pixel">{t("overview.genres.fromFeeds")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <SectionHeading hint={t("overview.try.hint")}>
          {t("overview.try.heading")}
        </SectionHeading>
        <Card className="p-5">
          <DigestPreview />
        </Card>
      </section>

      <section>
        <SectionHeading hint={t("overview.feeds.hint")}>
          {t("overview.feeds.heading")}
        </SectionHeading>
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="text-sm">
            {/* Chinese has no plural form, so the count is inside the string rather
                than concatenated with an "s" the translation cannot remove. */}
            <p className="text-muted">
              {t(
                feedCount === 1 ? "overview.feeds.countOne" : "overview.feeds.count",
                { count: feedCount },
              )}
            </p>
            {pendingFeeds > 0 ? (
              <p className="mt-1 text-xs text-pixel-3">
                {t("overview.feeds.pending", { count: pendingFeeds })}
              </p>
            ) : null}
          </div>
          <ButtonLink href="/app/subscriptions#screenshots" variant="outline">
            {t("overview.feeds.add")}
          </ButtonLink>
        </Card>
      </section>
    </div>
  );
}
