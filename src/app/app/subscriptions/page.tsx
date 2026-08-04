import { createClient, requireUser } from "@/lib/supabase/server";
import { Notice, SectionHeading } from "@/components/ui";
import type { City, Genre, GenrePref, Subscription } from "@/lib/db";
import { SubscriptionEditor } from "./subscription-editor";
import type { ToggleItem } from "./toggle-grid";
import { ArtistPrefList } from "./artist-prefs";
import { ArtistSearch } from "./artist-search";
import { SpotifyCard, type SpotifyState } from "./spotify-card";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Cities & genres — likelylist" };

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

  const spotify = await loadSpotifyState(user.id);

  const cities = (citiesResult.data ?? []) as Pick<
    City,
    "id" | "name" | "state_code"
  >[];
  const genres = (genresResult.data ?? []) as Pick<Genre, "id" | "name">[];

  const savedCityIds = (
    (subsResult.data ?? []) as Pick<Subscription, "city_id">[]
  ).map((row) => row.city_id);

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
      />

      <section>
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
    </div>
  );
}

/**
 * The reader's Spotify connection, or null when the server has no Spotify credentials.
 *
 * Uses the admin client because `spotify_links` is deny-all under RLS — it holds a
 * refresh token, so it is deliberately unreachable from any browser session. Scoped to
 * this one user by the eq() below.
 *
 * Returning null rather than an "unconnected" state hides the card entirely on a
 * deployment with no Spotify app configured, which is better than offering a button
 * that can only fail.
 */
async function loadSpotifyState(userId: string): Promise<SpotifyState | null> {
  const env = readEnv();
  if (!env.spotifyClientId || !env.spotifyClientSecret) return null;

  const supabase = createAdminClient(env);
  const { data } = await supabase
    .from("spotify_links")
    .select("last_imported_at, last_artist_count, invalid_since")
    .eq("user_id", userId)
    .maybeSingle<{
      last_imported_at: string | null;
      last_artist_count: number | null;
      invalid_since: string | null;
    }>();

  return {
    connected: Boolean(data),
    lastImportedAt: data?.last_imported_at ?? null,
    lastArtistCount: data?.last_artist_count ?? null,
    needsReconnect: Boolean(data?.invalid_since),
  };
}
