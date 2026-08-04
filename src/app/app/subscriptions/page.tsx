import { createClient, requireUser } from "@/lib/supabase/server";
import { Card, Notice, SectionHeading } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import type { City, Genre, GenrePref, Subscription } from "@/lib/db";
import { toggleCity, toggleGenre } from "./actions";
import { ToggleGrid, type ToggleItem } from "./toggle-grid";
import { ArtistPrefList } from "./artist-prefs";

export const metadata = { title: "Cities & genres — likelylist" };

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [citiesResult, genresResult, subsResult, prefsResult, artistsResult] =
    await Promise.all([
      supabase
        .from("cities")
        .select("id, name, state_code")
        .order("sort_order"),
      supabase.from("genres").select("id, name").order("sort_order"),
      supabase.from("subscriptions").select("city_id").eq("user_id", user.id),
      supabase
        .from("genre_prefs")
        .select("genre_id, source, weight")
        .eq("user_id", user.id),
      supabase
        .from("artist_prefs")
        .select("id, name, score, source, last_seen_at")
        .eq("user_id", user.id)
        .order("score", { ascending: false })
        .limit(60),
    ]);

  const cities = (citiesResult.data ?? []) as Pick<
    City,
    "id" | "name" | "state_code"
  >[];
  const genres = (genresResult.data ?? []) as Pick<Genre, "id" | "name">[];
  const subscribedCityIds = new Set(
    ((subsResult.data ?? []) as Pick<Subscription, "city_id">[]).map(
      (row) => row.city_id,
    ),
  );
  const prefs = (prefsResult.data ?? []) as Pick<
    GenrePref,
    "genre_id" | "source" | "weight"
  >[];
  const prefByGenre = new Map(prefs.map((pref) => [pref.genre_id, pref]));

  const cityItems: ToggleItem[] = cities.map((city) => ({
    id: city.id,
    label: city.name,
    sublabel: city.state_code,
    active: subscribedCityIds.has(city.id),
  }));

  // A row with weight 0 is a deliberate opt-out, not a subscription — see the
  // note on toggleGenre.
  const genreItems: ToggleItem[] = genres.map((genre) => {
    const pref = prefByGenre.get(genre.id);
    return {
      id: genre.id,
      label: genre.name,
      active: Boolean(pref && pref.weight > 0),
      inferred: pref?.source === "feed",
    };
  });

  const genresMissing = genres.length === 0;

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading hint="One Ticketmaster query is made per city you follow, shared across everyone who follows it.">
          Cities
        </SectionHeading>
        <Card className="p-5">
          <ToggleGrid
            items={cityItems}
            onToggle={toggleCity}
            searchPlaceholder="Filter cities…"
          />
          <p className="mt-4 text-xs text-faint">
            United States only. Listings outside the US come from a separate,
            much thinner Ticketmaster API that carries no genre IDs, so adding
            them would mean filtering a different way.
          </p>
        </Card>
      </section>

      <section>
        <SectionHeading hint="Filtering happens on each event's primary Ticketmaster genre.">
          Genres
        </SectionHeading>
        <Card className="p-5">
          {genresMissing ? (
            <Notice tone="warn">
              No genres are loaded yet. Run{" "}
              <code className="font-mono text-text">npm run seed:genres</code> —
              the genre IDs are read from Ticketmaster&apos;s live API rather than
              hardcoded, because Ticketmaster publishes no genre ID table and
              third-party lists disagree with each other.
            </Notice>
          ) : (
            <>
              <ToggleGrid
                items={genreItems}
                onToggle={toggleGenre}
                searchPlaceholder="Filter genres…"
              />
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-faint">
                <span className="flex items-center gap-1.5">
                  <PixelDot size={6} color="var(--pixel-1)" /> chosen by you
                </span>
                <span className="flex items-center gap-1.5">
                  <PixelDot size={6} color="var(--pixel-3)" /> inferred from a
                  feed
                </span>
              </div>
            </>
          )}
        </Card>
      </section>

      <section>
        <SectionHeading hint="Built up from the flyers you've fed in. Shows by these artists get pushed to the top of your digest.">
          Artists
        </SectionHeading>
        <ArtistPrefList
          artists={(artistsResult.data ?? []) as {
            id: number;
            name: string;
            score: number;
            source: string;
            last_seen_at: string;
          }[]}
        />
      </section>
    </div>
  );
}
