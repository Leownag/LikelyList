import { createClient, requireUser } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import type { City, Genre, GenrePref, Subscription } from "@/lib/db";
import { SubscriptionEditor } from "./subscription-editor";
import { SectionNav } from "./section-nav";
import { ScreenshotSection } from "./screenshot-section";
import { FollowedPlaces, type FollowedPlace } from "./followed-places";
import type { ToggleItem } from "./toggle-grid";
import { ArtistSearch } from "./artist-search";
import { SpotifyCard } from "./spotify-card";
import { loadSpotifyState } from "@/lib/spotify/state";
import { placeLabel } from "@/lib/places";

export const metadata = { title: "What I follow" };

/**
 * What /api/spotify/callback is telling us.
 *
 * It has always redirected here with one of these, and nothing read them — so
 * cancelling at Spotify's consent screen, or narrowing the scope, or an import
 * that failed, all returned the reader to an unchanged page with no explanation
 * whatsoever. Only `connected` was visible, and only because the card re-reads
 * its own state from the database.
 */
function spotifyOutcome(
  code: string | undefined,
  imported: string | undefined,
): { tone: "success" | "warn" | "error"; message: string } | null {
  switch (code) {
    case "connected": {
      const n = Number(imported);
      return {
        tone: "success",
        message: Number.isFinite(n) && n > 0
          ? `Spotify connected — ${n} artist${n === 1 ? "" : "s"} imported.`
          : "Spotify connected.",
      };
    }
    case "connected_no_import":
      return {
        tone: "warn",
        message:
          "Spotify is connected, but we could not read your top artists just now. It will try again with the next weekly run.",
      };
    case "cancelled":
      return {
        tone: "warn",
        message: "Spotify was not connected — you cancelled at their consent screen.",
      };
    case "missing_scope":
      return {
        tone: "warn",
        message:
          "Spotify did not grant access to your top artists, which is the one thing this uses. Try connecting again and leave that permission ticked.",
      };
    case "expired":
      return {
        tone: "warn",
        message: "That took too long and the link expired. Try connecting again.",
      };
    case "no_refresh_token":
      return {
        tone: "error",
        message:
          "Spotify did not return a lasting connection. Disconnect it in your Spotify account settings, then try again.",
      };
    case "invalid":
    case "failed":
      return { tone: "error", message: "Connecting to Spotify did not work. Try again." };
    case "not_configured":
      return {
        tone: "error",
        message: "Spotify is not set up on this deployment.",
      };
    default:
      return null;
  }
}

export default async function SubscriptionsPage({
  searchParams,
}: PageProps<"/app/subscriptions">) {
  const {
    subscribed,
    spotify: spotifyParam,
    artists: importedCount,
  } = await searchParams;
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
      // By name, not by score: the score is no longer shown, and sorting by it put the
      // switched-off artists (score 0) last, where the limit truncated them first — so the
      // ones you have to be able to find in order to switch back on were the ones missing.
      supabase
        .from("artist_prefs")
        .select("id, name, score, source")
        .eq("user_id", user.id)
        .order("name")
        .limit(200),
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
    // The chip renders label and sublabel as adjacent elements, so a name that
    // already carries its state produced "Washington, DC DC". placeLabel is the
    // authority on whether the state is already in there.
    sublabel: placeLabel(city.name, city.state_code) === city.name ? null : city.state_code,
  }));

  const genreItems: ToggleItem[] = genres.map((genre) => ({
    id: genre.id,
    label: genre.name,
  }));

  const artists = (artistsResult.data ?? []) as {
    id: number;
    name: string;
    score: number;
    source: string;
  }[];

  // Provenance in the sublabel rather than ToggleGrid's `inferred` flag: that one is
  // hardcoded to say "·feed", which is wrong for a Spotify import, and it only renders
  // while selected — the opposite of what a list you switch things off in needs.
  const artistItems: ToggleItem[] = artists.map((artist) => ({
    id: artist.id,
    label: artist.name,
    sublabel: artist.source === "explicit" ? null : artist.source,
  }));

  // Same reading as the genre weight above: zero means switched off, not unranked.
  const savedArtistIds = artists
    .filter((artist) => artist.score > 0)
    .map((artist) => artist.id);

  const spotifyNotice = spotifyOutcome(
    typeof spotifyParam === "string" ? spotifyParam : undefined,
    typeof importedCount === "string" ? importedCount : undefined,
  );

  return (
    <div className="space-y-10">
      <SectionNav />

      {spotifyNotice ? (
        <Notice tone={spotifyNotice.tone}>{spotifyNotice.message}</Notice>
      ) : null}

      {subscribed ? (
        <Notice tone="success">
          You&apos;re subscribed and signed in. Your first digest arrives Wednesday
          morning — everything below is what it covers.
        </Notice>
      ) : null}

      {genres.length === 0 ? (
        <Notice tone="warn">
          Genres are not available right now, so the digest will not be filtered
          by them. Everything else below still works. (Operators: this means the
          genre taxonomy has not been loaded — see the README.)
        </Notice>
      ) : null}

      <SubscriptionEditor
        cities={cityItems}
        genres={genreItems}
        artists={artistItems}
        savedCityIds={savedCityIds}
        savedGenreIds={savedGenreIds}
        savedArtistIds={savedArtistIds}
        inferredGenreIds={inferredGenreIds}
        placesControl={<FollowedPlaces places={followedPlaces} />}
        artistsControl={
          <>
            {spotify ? (
              <div className="mb-4">
                <SpotifyCard state={spotify} />
              </div>
            ) : null}
            <ArtistSearch />
          </>
        }
      />

      <section id="screenshots" className="scroll-mt-16">
        <ScreenshotSection />
      </section>
    </div>
  );
}
