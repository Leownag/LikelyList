import { createClient, requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEnv } from "@/lib/env";
import { buildDigest } from "@/lib/digest/build";
import { digestWindow, localDateString } from "@/lib/time";
import { EmptyState, Notice, SectionHeading } from "@/components/ui";
import { EventCard } from "@/components/event-card";
import type { Profile } from "@/lib/db";
import type { PinInput } from "@/lib/pins/types";

export const metadata = { title: "My feed — likelylist" };

/**
 * This week's shows for this reader — the Friday email, on screen, now.
 *
 * Reuses buildDigest rather than reimplementing the scoring, so the page and the email
 * can never disagree about what belongs in someone's week. `skipEnrichment` is set
 * because the YouTube lookup exists to put real video links in an email; here the
 * performer links are search URLs computed at render time, and spending a metered
 * lookup (100/day for the whole project) on a page refresh would starve the send.
 *
 * Reads from `events_cache`, which the Friday planner fills — so between a purge and
 * the next run this can legitimately be empty. That is explained rather than hidden,
 * because "no shows" and "nothing cached yet" are different facts and only one of them
 * is about the reader's filters.
 */
export default async function FeedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const env = readEnv();

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
            `${window.startDate} … ${window.endDate} — the same scoring the Friday email ` +
            `uses, so this is what it would say if it went out now.` +
            (digest && digest.events.length > 1
              ? digest.ordering === "relevance"
                ? " Best matches first."
                : // Genres alone all weigh the same, so there is nothing to rank by and
                  // the list is chronological. Said plainly rather than implied away.
                  " In date order — follow some artists and the best matches rise to the top."
              : "")
          }
        >
          My feed
        </SectionHeading>

        {!digest ? (
          <Notice tone="warn">
            The feed needs the service role key, which is not configured on this
            deployment.
          </Notice>
        ) : digest.events.length === 0 ? (
          <EmptyState title="nothing this week">
            {digest.cities.length === 0
              ? "You haven't followed a city yet — that is the one thing the feed cannot guess."
              : "No listed shows matched your genres or artists. Listings are refreshed by the Friday run, so a brand-new account can look empty until then."}
            <div className="mt-4 text-sm">
              <a className="text-accent underline" href="/app/subscriptions">
                Change what you follow
              </a>
              {" · "}
              <a className="text-accent underline" href="/explore">
                Search any city instead
              </a>
            </div>
          </EmptyState>
        ) : (
          <>
            {digest.fallbackReason === "no_preferences" ? (
              <div className="mb-4">
                <Notice tone="warn">
                  You haven&apos;t told us what you listen to yet, so this is
                  everything listed in{" "}
                  {digest.cities.join(", ") || "your cities"} — not a filtered
                  selection.{" "}
                  <a className="underline" href="/app/subscriptions">
                    Pick your genres
                  </a>
                  .
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
    // Not carried through the digest pipeline — the email renders a formatted label and
    // never needed the raw values. Pinning from here therefore stores a date without a
    // time, which "add to calendar" turns into an all-day entry rather than guessing.
    localTime: null,
    timezone: null,
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
