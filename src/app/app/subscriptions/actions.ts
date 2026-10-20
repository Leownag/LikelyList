"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireUser } from "@/lib/supabase/server";
import { normalizeName } from "@/lib/normalize";
import { geoCellKey } from "@/lib/geo-cell";
// The scale every artist signal shares — see lib/artist-score for why the numbers
// only make sense relative to each other.
import { EXPLICIT_ARTIST_SCORE, OPTED_OUT_SCORE } from "@/lib/artist-score";
import type { City } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Subscription and preference mutations.
 *
 * One action commits the whole selection rather than one per click. Per-click
 * actions meant a server round-trip and a `revalidatePath` on every chip, which
 * is what made the list flicker and jump; they also made "change three things and
 * change your mind" impossible.
 *
 * Everything goes through the request-scoped Supabase client, so RLS enforces
 * ownership rather than this code having to.
 */

export type SaveResult = {
  cities: number;
  genres: number;
};

export async function saveSelections(input: {
  cityIds: number[];
  genreIds: number[];
  /**
   * Artists are a delta, not a set.
   *
   * The other two are chosen from a full catalogue, so "everything not in this list is
   * off" is a safe reading. artist_prefs holds only artists you already follow and the
   * page renders a bounded slice of it, so the same reading would silently opt out
   * anybody the limit truncated. Only ids the reader actually clicked are sent.
   */
  artistsOn?: number[];
  artistsOff?: number[];
}): Promise<SaveResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const wantedCities = new Set(input.cityIds.filter(Number.isInteger));
  const wantedGenres = new Set(input.genreIds.filter(Number.isInteger));

  // --- Cities ---------------------------------------------------------------
  const { data: existingCityRows } = await supabase
    .from("subscriptions")
    .select("id, city_id")
    .eq("user_id", user.id);

  const existingCities = new Map(
    ((existingCityRows ?? []) as { id: number; city_id: number | null }[]).map(
      (row) => [row.city_id, row.id],
    ),
  );

  // Only rows this grid could have created are the grid's to remove. Since 0014 a
  // subscription is a point and `city_id` is nullable, so a followed Census place keys
  // this map on null — and null is never in `wantedCities`, which would have made
  // pressing Save on the city picker delete every subscription the picker cannot show.
  const cityIdsToDelete = [...existingCities.entries()]
    .filter(([cityId]) => cityId !== null && !wantedCities.has(cityId))
    .map(([, rowId]) => rowId);

  const citiesToInsert = [...wantedCities].filter(
    (cityId) => !existingCities.has(cityId),
  );

  if (cityIdsToDelete.length > 0) {
    await supabase.from("subscriptions").delete().in("id", cityIdsToDelete);
  }
  if (citiesToInsert.length > 0) {
    // A subscription is a point since 0014, so the city's own coordinates are copied
    // in. Without them the planner has nothing to search from — the city name is only a
    // label now, and Ticketmaster ignores `radius` unless it is given a point.
    const { data: cityRows } = await supabase
      .from("cities")
      .select("id, name, state_code, latitude, longitude")
      .in("id", citiesToInsert);

    const rows = ((cityRows ?? []) as Pick<
      City,
      "id" | "name" | "state_code" | "latitude" | "longitude"
    >[])
      .filter((city) => city.latitude != null && city.longitude != null)
      .map((city) => ({
        user_id: user.id,
        city_id: city.id,
        latitude: Number(city.latitude),
        longitude: Number(city.longitude),
        place_name: city.name,
        state_code: city.state_code,
        geo_cell: geoCellKey(Number(city.latitude), Number(city.longitude)),
      }));

    if (rows.length > 0) {
      await supabase
        .from("subscriptions")
        .upsert(rows, { onConflict: "user_id,latitude,longitude" });
    }
  }

  // --- Genres ---------------------------------------------------------------
  //
  // Deselecting writes an explicit weight-0 row instead of deleting, because
  // feed processing only inserts a genre when the user has *no* row for it. A
  // zero-weight row is therefore a permanent opt-out; deleting would let the next
  // flyer of that genre quietly switch it back on.
  const { data: existingPrefRows } = await supabase
    .from("genre_prefs")
    .select("id, genre_id, weight")
    .eq("user_id", user.id);

  const existingPrefs = new Map(
    ((existingPrefRows ?? []) as {
      id: number;
      genre_id: number;
      weight: number;
    }[]).map((row) => [row.genre_id, row]),
  );

  const prefsToInsert: { user_id: string; genre_id: number; source: "explicit"; weight: number }[] = [];
  const idsToEnable: number[] = [];
  const idsToDisable: number[] = [];

  for (const genreId of wantedGenres) {
    const existing = existingPrefs.get(genreId);
    if (!existing) {
      prefsToInsert.push({
        user_id: user.id,
        genre_id: genreId,
        source: "explicit",
        weight: 1,
      });
    } else if (existing.weight === 0) {
      idsToEnable.push(existing.id);
    }
  }

  for (const [genreId, existing] of existingPrefs) {
    if (!wantedGenres.has(genreId) && existing.weight > 0) {
      idsToDisable.push(existing.id);
    }
  }

  if (prefsToInsert.length > 0) {
    await supabase.from("genre_prefs").insert(prefsToInsert);
  }
  if (idsToEnable.length > 0) {
    await supabase
      .from("genre_prefs")
      .update({ weight: 1, source: "explicit" })
      .in("id", idsToEnable);
  }
  if (idsToDisable.length > 0) {
    await supabase
      .from("genre_prefs")
      .update({ weight: 0, source: "explicit" })
      .in("id", idsToDisable);
  }

  // --- Artists --------------------------------------------------------------
  //
  // Same shape as the genre opt-out above, for the same reason: feeds/apply.ts and
  // spotify/import.ts both upsert on (user_id, normalized_name), so a deleted artist
  // comes back on the next screenshot or sync. Writing 'explicit' is what keeps them
  // off the row — import.ts filters explicit rows out of its upsert and only ever
  // retires source='spotify'.
  //
  // `.eq("user_id")` on top of RLS because a row id arrives from the client.
  const artistsOff = (input.artistsOff ?? []).filter(Number.isInteger);
  const artistsOn = (input.artistsOn ?? []).filter(Number.isInteger);

  if (artistsOff.length > 0) {
    await supabase
      .from("artist_prefs")
      .update({ score: OPTED_OUT_SCORE, source: "explicit" })
      .eq("user_id", user.id)
      .in("id", artistsOff);
  }
  if (artistsOn.length > 0) {
    await supabase
      .from("artist_prefs")
      .update({ score: EXPLICIT_ARTIST_SCORE, source: "explicit" })
      .eq("user_id", user.id)
      .in("id", artistsOn);
  }

  // Revalidated once, after everything, rather than per toggle.
  revalidatePath("/app/subscriptions");
  revalidatePath("/app");

  return { cities: wantedCities.size, genres: wantedGenres.size };
}

/**
 * How many towns outside the curated list one reader may follow.
 *
 * Not a preference — a cost. The planner makes one Ticketmaster call per distinct
 * grid cell each week against a 5000/day budget the weekly send shares, so an
 * unbounded follow list is a way for one account to spend everyone's quota. The
 * curated grid is bounded by being a list of 43; this path is open to 32,329 places
 * and needs its own ceiling.
 */
const MAX_FOLLOWED_PLACES = 10;

/**
 * Follow any US place, by its Census GEOID.
 *
 * The point of migration 0014: a subscription is coordinates, so it does not have to
 * be one of the 43 curated metros. This is the write path that was missing — /explore
 * could already search Amherst, MA, and nothing could subscribe to it.
 *
 * Only the id crosses the network. The coordinates are read from `places` here rather
 * than taken from the caller, so a crafted call cannot subscribe to an arbitrary point
 * and buy itself a weekly Ticketmaster query for it.
 *
 * Immediate rather than batched into Save: this adds one row for one named place, and
 * the city grid's commit-together model exists for working through a long list of
 * toggles, which this is not.
 */
export async function followPlace(
  geoid: string,
): Promise<{ name: string; stateCode: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  if (!/^\d{2,10}$/.test(geoid)) throw new Error("That is not a place id.");

  // `places` is deny-all under RLS — it is a shared reference table, not anybody's
  // rows — so the lookup needs the admin client. Scoped to one id.
  const env = readEnv();
  if (!env.supabaseServiceRoleKey) {
    throw new Error("Following a town is not configured on this server yet.");
  }

  const { data: place } = await createAdminClient(env)
    .from("places")
    .select("name, state_code, latitude, longitude")
    .eq("geoid", geoid)
    .maybeSingle<{
      name: string;
      state_code: string | null;
      latitude: number;
      longitude: number;
    }>();

  if (!place) throw new Error("We don't have a place with that id.");

  const { count } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("city_id", null);

  if ((count ?? 0) >= MAX_FOLLOWED_PLACES) {
    throw new Error(
      `That is ${MAX_FOLLOWED_PLACES} towns already — remove one before adding another.`,
    );
  }

  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);

  // `city_id` stays null on purpose: it is what marks this as a row the city grid did
  // not create and must never delete. See the delete scope in saveSelections.
  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: user.id,
      city_id: null,
      latitude,
      longitude,
      place_name: place.name,
      state_code: place.state_code,
      geo_cell: geoCellKey(latitude, longitude),
    },
    { onConflict: "user_id,latitude,longitude" },
  );

  if (error) throw new Error(`Could not follow that town: ${error.message}`);

  revalidatePath("/app/subscriptions");
  revalidatePath("/app");
  return { name: place.name, stateCode: place.state_code };
}

/** Stop following a place. By row id, so RLS is the only ownership check needed. */
export async function unfollowPlace(subscriptionId: number): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();

  await supabase
    .from("subscriptions")
    .delete()
    .eq("id", subscriptionId)
    .eq("user_id", user.id)
    // Belt to the city grid's braces: this control only ever shows point
    // subscriptions, so it should not be able to remove a curated one either.
    .is("city_id", null);

  revalidatePath("/app/subscriptions");
  revalidatePath("/app");
}

/**
 * Follow an artist chosen from the search box.
 *
 * The Ticketmaster identity is resolved before this is called (see
 * /api/artists/search) so that `normalized_name` here matches the name that
 * arrives in event lineups — which is the only reason the follow can ever match
 * an event.
 *
 * An existing row is raised to the explicit score rather than incremented: this
 * is a statement, not another sighting, and re-adding an artist should not keep
 * inflating them.
 */
export async function followArtist(input: {
  name: string;
  tmAttractionId: string | null;
}): Promise<{ name: string }> {
  const user = await requireUser();
  const supabase = await createClient();

  const name = input.name.trim().slice(0, 200);
  const normalized = normalizeName(name);
  if (!normalized) throw new Error("That name is empty once normalised.");

  const { data: existing } = await supabase
    .from("artist_prefs")
    .select("id, score")
    .eq("user_id", user.id)
    .eq("normalized_name", normalized)
    .maybeSingle<{ id: number; score: number }>();

  const now = new Date().toISOString();

  if (existing) {
    await supabase
      .from("artist_prefs")
      .update({
        name,
        tm_attraction_id: input.tmAttractionId,
        score: Math.max(Number(existing.score), EXPLICIT_ARTIST_SCORE),
        source: "explicit",
        last_seen_at: now,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("artist_prefs").insert({
      user_id: user.id,
      name,
      normalized_name: normalized,
      tm_attraction_id: input.tmAttractionId,
      score: EXPLICIT_ARTIST_SCORE,
      source: "explicit",
      last_seen_at: now,
    });
  }

  revalidatePath("/app/subscriptions");
  revalidatePath("/app");

  return { name };
}

/**
 * Disconnects Spotify.
 *
 * Deletes the link row, which is where the refresh token lives, so the credential is
 * gone rather than merely flagged. The artists it imported are deliberately left
 * behind: they are the reader's preferences now, and silently emptying their follow
 * list because they unlinked an account would destroy work they did not ask to undo.
 * They can remove any of them individually.
 */
export async function disconnectSpotify() {
  const user = await requireUser();
  const env = readEnv();

  // The admin client, because spotify_links is deny-all under RLS — it holds a
  // long-lived credential and is deliberately unreachable from a browser session.
  // Scoped to this user's own row by the eq() below.
  const supabase = createAdminClient(env);
  await supabase.from("spotify_links").delete().eq("user_id", user.id);

  revalidatePath("/app/subscriptions");
}
