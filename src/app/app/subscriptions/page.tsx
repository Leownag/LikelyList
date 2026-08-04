import { createClient, requireUser } from "@/lib/supabase/server";
import { Notice, SectionHeading } from "@/components/ui";
import type { City, Genre, GenrePref, Subscription } from "@/lib/db";
import { SubscriptionEditor } from "./subscription-editor";
import { SectionNav } from "./section-nav";
import { ScreenshotSection } from "./screenshot-section";
import { FollowedPlaces, type FollowedPlace } from "./followed-places";
import type { ToggleItem } from "./toggle-grid";
import { ArtistPrefList } from "./artist-prefs";
import { ArtistSearch } from "./artist-search";
import { SpotifyCard } from "./spotify-card";
import { loadSpotifyState } from "@/lib/spotify/state";

export const metadata = { title: "What I follow" };

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [citiesResult, genresResult, subsResult, prefsResult, artistsResult] =
    await Promise.all([
      supabase.from("cities").select("id, name, state_code").order("sort_order"),
      // sort_order is a curated popularity ranking, seeded by
      // scripts/seed-genres.ts — Ticketmaster exposes no popularity signal, and
      // alphabetical put Alternative and Blues ahead of Rock and Pop.
      supabase.from("genres").select("id, name").order("sort_order"),
      supabase
        .from("subscriptions")
        .select("id, city_id, place_name, state_code")
        .eq("user_id", user.id),
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

  const spotify = await loadSpotifyState(user.id);

  const cities = (citiesResult.data ?? []) as Pick<
    City,
    "id" | "name" | "state_code"
  >[];
  const genres = (genresResult.data ?? []) as Pick<Genre, "id" | "name">[];

  const subscriptions = (subsResult.data ?? []) as Pick<
    Subscription,
    "id" | "city_id" | "place_name" | "state_code"
  >[];

  const savedCityIds = subscriptions
    .map((row) => row.city_id)
    .filter((id): id is number => id !== null);

  // A null city_id means it came from the town search rather than the curated grid, so
  // the grid cannot show it and needs its own list to remove it from.
  const followedPlaces: FollowedPlace[] = subscriptions
    .filter((row) => row.city_id === null)
    .map((row) => ({
      id: row.id,
      name: row.place_name ?? "Unnamed place",
      stateCode: row.state_code,
    }));

  const prefs = (prefsResult.data ?? []) as Pick<
    GenrePref,
    "genre_id" | "source" | "weight"
  >[];

  // A row with weight 0 is a deliberate opt-out, not a subscription.
  const savedGenreIds = prefs
    .filter((pref) => pref.weight > 0)
    .map((pref) => pref.genre_id);
  const inferredGenreIds = prefs
    .filter((pref) => pref.weight > 0 && pref.source === "feed")
    .map((pref) => pref.genre_id);

  const cityItems: ToggleItem[] = cities.map((city) => ({
    id: city.id,
    label: city.name,
    sublabel: city.state_code,
  }));

  const genreItems: ToggleItem[] = genres.map((genre) => ({
    id: genre.id,
    label: genre.name,
  }));

  return (
    <div className="space-y-10">
      <SectionNav />

      {genres.length === 0 ? (
        <Notice tone="warn">
          No genres are loaded yet. Run{" "}
          <code className="font-mono text-text">npm run seed:genres</code> — the
          genre IDs are read from Ticketmaster&apos;s live API rather than
          hardcoded, because Ticketmaster publishes no genre ID table and
          third-party lists disagree with each other.
        </Notice>
      ) : null}

      <SubscriptionEditor
        cities={cityItems}
        genres={genreItems}
        savedCityIds={savedCityIds}
        savedGenreIds={savedGenreIds}
        inferredGenreIds={inferredGenreIds}
        placesControl={<FollowedPlaces places={followedPlaces} />}
      />

      <section id="artists" className="scroll-mt-16">
        <SectionHeading hint="Search for anyone you don't want to miss, or let a screenshot fill this in. Shows by these artists get pushed to the top of your digest — and reach it even in a genre you don't follow.">
          Artists
        </SectionHeading>
        {spotify ? (
          <div className="mb-4">
            <SpotifyCard state={spotify} />
          </div>
        ) : null}

        <ArtistSearch />
        <ArtistPrefList
          artists={
            (artistsResult.data ?? []) as {
              id: number;
              name: string;
              score: number;
              source: string;
              last_seen_at: string;
            }[]
          }
        />
      </section>

      <section id="screenshots" className="scroll-mt-16">
        <ScreenshotSection />
      </section>
    </div>
  );
}
