"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireUser } from "@/lib/supabase/server";
import { normalizeName } from "@/lib/normalize";
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
    ((existingCityRows ?? []) as { id: number; city_id: number }[]).map((row) => [
      row.city_id,
      row.id,
    ]),
  );

  const cityIdsToDelete = [...existingCities.entries()]
    .filter(([cityId]) => !wantedCities.has(cityId))
    .map(([, rowId]) => rowId);

  const citiesToInsert = [...wantedCities].filter(
    (cityId) => !existingCities.has(cityId),
  );

  if (cityIdsToDelete.length > 0) {
    await supabase.from("subscriptions").delete().in("id", cityIdsToDelete);
  }
  if (citiesToInsert.length > 0) {
    await supabase.from("subscriptions").insert(
      citiesToInsert.map((cityId) => ({ user_id: user.id, city_id: cityId })),
    );
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

  // Revalidated once, after everything, rather than per toggle.
  revalidatePath("/app/subscriptions");
  revalidatePath("/app");

  return { cities: wantedCities.size, genres: wantedGenres.size };
}

/**
 * The score a hand-picked artist starts on.
 *
 * Above the strongest a screenshot can produce (`primary` = 1.0 in
 * lib/feeds/apply.ts), because typing a name in is a clearer statement of intent
 * than appearing on a playlist someone screenshotted. buildDigest caps the total
 * artist contribution anyway, so this cannot swamp a week.
 */
const EXPLICIT_ARTIST_SCORE = 1.5;

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

export async function removeArtistPref(artistPrefId: number) {
  const user = await requireUser();
  const supabase = await createClient();

  await supabase
    .from("artist_prefs")
    .delete()
    .eq("id", artistPrefId)
    .eq("user_id", user.id);

  revalidatePath("/app/subscriptions");
}
