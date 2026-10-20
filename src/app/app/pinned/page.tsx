import { createClient, requireUser } from "@/lib/supabase/server";
import { EmptyState, SectionHeading } from "@/components/ui";
import { EventCard } from "@/components/event-card";
import type { Pin } from "@/lib/pins/types";
import { getI18n } from "@/lib/i18n/server";
import { SLOT, interleave } from "@/lib/i18n/interleave";

export async function generateMetadata() {
  return { title: (await getI18n()).t("title.pinned") };
}

/**
 * The shows the reader saved.
 *
 * Rendered from `pinned_events` alone — no Ticketmaster call, no events_cache read.
 * That is the point of copying the details in at pin time: this page keeps working for
 * a show six months out, long after the 36-hour cache that first surfaced it was purged.
 *
 * Past shows are kept rather than hidden. Somebody who pinned a gig and went to it may
 * well want to remember which night it was, and quietly deleting their history to keep
 * a list tidy is not ours to do. They are separated out so the top of the page is still
 * the things that have not happened yet.
 */
export default async function PinnedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { t } = await getI18n();

  const { data } = await supabase
    .from("pinned_events")
    .select(
      "id, tm_event_id, name, url, local_date, local_time, timezone, venue_name, city_label, image_url, genre_name, performers, pinned_at",
    )
    .eq("user_id", user.id)
    .order("local_date", { ascending: true, nullsFirst: false });

  const pins: Pin[] = ((data ?? []) as PinRow[]).map(toPin);

  // Compared as strings against the venue-local date, deliberately. Converting either
  // side to an instant would need a timezone per row and would move a show across
  // midnight for no benefit — "is this in the past" does not need that precision.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = pins.filter((pin) => !pin.localDate || pin.localDate >= today);
  const past = pins.filter((pin) => pin.localDate && pin.localDate < today);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading hint={t("pinned.hint")}>{t("pinned.heading")}</SectionHeading>

        {/* Keyed on the whole list, not just `upcoming`. Testing `upcoming` alone
            put "nothing pinned yet" directly above a populated "Already happened"
            section — the page contradicting itself for anyone whose pins have all
            taken place. Nothing pinned at all is a different state from nothing
            coming up, and they get different sentences. */}
        {pins.length === 0 ? (
          <EmptyState title={t("pinned.empty.title")}>
            {/* Two links inside one sentence, so the translation places them rather than
                being handed a pre-assembled English clause order. */}
            {interleave(t("pinned.empty.body", { feed: SLOT, search: SLOT }), [
              <a key="feed" className="text-accent underline" href="/app/feed">
                {t("pinned.empty.feed")}
              </a>,
              <a key="search" className="text-accent underline" href="/explore">
                {t("pinned.empty.search")}
              </a>,
            ])}
          </EmptyState>
        ) : upcoming.length === 0 ? (
          <EmptyState title={t("pinned.none.title")}>
            {t("pinned.none.body")}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((pin) => (
              <li key={pin.id}>
                <EventCard event={pin} pinned signedIn />
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section>
          <SectionHeading hint={t("pinned.past.hint")}>
            {t("pinned.past.heading")}
          </SectionHeading>
          <ul className="space-y-3 opacity-60">
            {past.map((pin) => (
              <li key={pin.id}>
                <EventCard event={pin} pinned signedIn />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

type PinRow = {
  id: number;
  tm_event_id: string;
  name: string;
  url: string | null;
  local_date: string | null;
  local_time: string | null;
  timezone: string | null;
  venue_name: string | null;
  city_label: string | null;
  image_url: string | null;
  genre_name: string | null;
  performers: { name: string; isHeadliner: boolean }[] | null;
  pinned_at: string;
};

function toPin(row: PinRow): Pin {
  return {
    id: row.id,
    tmEventId: row.tm_event_id,
    name: row.name,
    url: row.url,
    localDate: row.local_date,
    // Postgres renders a `time` as HH:MM:SS; the calendar builder wants exactly that.
    localTime: row.local_time,
    timezone: row.timezone,
    venueName: row.venue_name,
    cityLabel: row.city_label,
    imageUrl: row.image_url,
    genreName: row.genre_name,
    performers: row.performers ?? [],
    pinnedAt: row.pinned_at,
  };
}
