import { createClient, requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEnv } from "@/lib/env";
import { buildDigest } from "@/lib/digest/build";
import { digestWindow, localDateString } from "@/lib/time";
import { EmptyState, Notice, SectionHeading } from "@/components/ui";
import { EventCard } from "@/components/event-card";
import type { Profile } from "@/lib/db";
import type { PinInput } from "@/lib/pins/types";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  return { title: (await getI18n()).t("title.feed") };
}

/**
 * This week's shows for this reader — the Wednesday email, on screen, now.
 *
 * Reuses buildDigest rather than reimplementing the scoring, so the page and the email
 * can never disagree about what belongs in someone's week. `skipEnrichment` is set
 * because the YouTube lookup exists to put real video links in an email; here the
 * performer links are search URLs computed at render time, and spending a metered
 * lookup (100/day for the whole project) on a page refresh would starve the send.
 *
 * Reads from `events_cache`, which the weekly planner fills — so between a purge and
 * the next run this can legitimately be empty. That is explained rather than hidden,
 * because "no shows" and "nothing cached yet" are different facts and only one of them
 * is about the reader's filters.
 */
export default async function FeedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const env = readEnv();
  const { t } = await getI18n();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "timezone">>();

  const timezone = profile?.timezone ?? "America/New_York";
  const window = digestWindow(new Date(), timezone);

  // The admin client, because buildDigest reads events_cache and artists — both
  // deny-all under RLS, since they are shared caches rather than anybody's rows.
  const digest = env.supabaseServiceRoleKey
    ? await buildDigest(createAdminClient(env), env, user.id, {
        startDate: window.startDate,
        endDate: window.endDate,
        skipEnrichment: true,
      })
    : null;

  // Which of these are already pinned, so the button starts in the right state. One
  // query for the set rather than one per card.
  const { data: pinRows } = await supabase
    .from("pinned_events")
    .select("tm_event_id")
    .eq("user_id", user.id);
  const pinnedIds = new Set(
    ((pinRows ?? []) as { tm_event_id: string }[]).map((row) => row.tm_event_id),
  );

  const today = localDateString(timezone, new Date());

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading
          hint={
            t("feed.hint", {
              window: `${window.startDate} … ${window.endDate}`,
            }) +
            (digest && digest.events.length > 1
              ? digest.ordering === "relevance"
                ? ` ${t("feed.hint.relevance")}`
                : // Genres alone all weigh the same, so there is nothing to rank by and
                  // the list is chronological. Said plainly rather than implied away.
                  ` ${t("feed.hint.dateOrder")}`
              : "")
          }
        >
          {t("feed.heading")}
        </SectionHeading>

        {!digest ? (
          <Notice tone="warn">{t("feed.unconfigured")}</Notice>
        ) : digest.events.length === 0 ? (
          <EmptyState title={t("feed.empty.title")}>
            {digest.cities.length === 0
              ? t("feed.empty.noCity")
              : t("feed.empty.noMatch")}
            <div className="mt-4 text-sm">
              <a className="text-accent underline" href="/app/subscriptions">
                {t("feed.empty.change")}
              </a>
              {" · "}
              <a className="text-accent underline" href="/explore">
                {t("feed.empty.search")}
              </a>
            </div>
          </EmptyState>
        ) : (
          <>
            {digest.fallbackReason === "no_preferences" ? (
              <div className="mb-4">
                <Notice tone="warn">
                  {t("feed.unfiltered", {
                    cities: digest.cities.join(", ") || t("feed.yourCities"),
                  })}{" "}
                  <a className="underline" href="/app/subscriptions">
                    {t("feed.unfiltered.link")}
                  </a>
                </Notice>
              </div>
            ) : null}

            <ul className="space-y-3">
              {digest.events.map((event) => (
                <li key={event.tmEventId}>
                  <EventCard
                    event={toPinInput(event, today)}
                    pinned={pinnedIds.has(event.tmEventId)}
                    signedIn
                    becauseOf={event.matchedArtists}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * A digest event as the card and the pin both want it.
 *
 * `localDate` falls back to today rather than null when Ticketmaster gave no date: the
 * digest already filters those out, and a null here would render "Date TBA" on a show
 * that has one.
 */
function toPinInput(
  event: {
    tmEventId: string;
    name: string;
    url: string | null;
    localDate: string;
    localTime: string | null;
    timezone: string | null;
    venueName: string | null;
    cityLabel: string;
    imageUrl: string | null;
    genreName: string | null;
    performers: { name: string; isHeadliner: boolean }[];
  },
  today: string,
): PinInput {
  return {
    tmEventId: event.tmEventId,
    name: event.name,
    url: event.url,
    localDate: event.localDate || today,
    localTime: event.localTime,
    timezone: event.timezone,
    venueName: event.venueName,
    cityLabel: event.cityLabel,
    imageUrl: event.imageUrl,
    genreName: event.genreName,
    performers: event.performers.slice(0, 12).map((performer) => ({
      name: performer.name,
      isHeadliner: performer.isHeadliner,
    })),
  };
}
