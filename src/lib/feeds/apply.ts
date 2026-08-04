import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName } from "@/lib/normalize";
import { createTicketmasterClient } from "@/lib/ticketmaster/client";
import {
  findAttractionByName,
  toArtistRow,
} from "@/lib/ticketmaster/attractions";
import { primaryClassification } from "@/lib/ticketmaster/lineup";
import type { Genre } from "@/lib/db";

/**
 * Turns a confirmed extraction into preferences.
 *
 * This is the step that makes feeds do anything. Extraction alone never moves a
 * preference — the user confirms first — because poster reading is imperfect and
 * silently reweighting someone's digest off a misread name is worse than asking.
 *
 * Genres are inferred from two independent signals, and each one is weak alone:
 *   1. genre words printed on the flyer, matched against our genre table
 *   2. the Ticketmaster classification of each artist we can resolve
 *
 * A feed-derived genre is only ever *inserted* when the user has no row for that
 * genre at all. An existing row — including a zero-weight opt-out — is left
 * untouched, so an explicit "not this" survives any number of later flyers.
 */

export type ConfirmedArtist = {
  name: string;
  role: "headliner" | "support" | null;
};

export type ApplyInput = {
  userId: string;
  feedId: string;
  artists: ConfirmedArtist[];
  /** Genre words as printed on the flyer. */
  printedGenres: string[];
  ticketmasterApiKey: string;
};

export type ApplyResult = {
  artistsLearned: number;
  genresAdded: string[];
  artistsResolved: number;
  /** Set when Ticketmaster lookup was skipped or failed; not fatal. */
  warning?: string;
};

export async function applyFeed(
  supabase: SupabaseClient,
  input: ApplyInput,
): Promise<ApplyResult> {
  const { userId, feedId, artists, printedGenres } = input;

  const deduped = dedupeArtists(artists);

  const { data: genreRows } = await supabase
    .from("genres")
    .select("id, tm_genre_id, name");
  const genres = (genreRows ?? []) as Pick<Genre, "id" | "tm_genre_id" | "name">[];

  const genreByTmId = new Map(genres.map((genre) => [genre.tm_genre_id, genre]));
  const genreByName = new Map(
    genres.map((genre) => [normalizeName(genre.name), genre]),
  );

  const matchedGenreIds = new Set<number>();
  const matchedGenreNames = new Set<string>();

  // Signal 1: genre words printed on the flyer.
  for (const printed of printedGenres) {
    const genre = genreByName.get(normalizeName(printed));
    if (genre) {
      matchedGenreIds.add(genre.id);
      matchedGenreNames.add(genre.name);
    }
  }

  // Signal 2: Ticketmaster's own classification of each artist.
  let artistsResolved = 0;
  let warning: string | undefined;

  if (input.ticketmasterApiKey && deduped.length > 0) {
    try {
      const client = createTicketmasterClient(input.ticketmasterApiKey);

      for (const artist of deduped) {
        const attraction = await findAttractionByName(client, artist.name);
        if (!attraction) continue;

        artistsResolved += 1;
        artist.tmAttractionId = attraction.id;

        const tmGenreId = primaryClassification(attraction).genreId;
        if (tmGenreId) {
          const genre = genreByTmId.get(tmGenreId);
          if (genre) {
            matchedGenreIds.add(genre.id);
            matchedGenreNames.add(genre.name);
          }
        }

        // Cache the artist so the weekly enrichment does not have to look it up
        // again, and so the YouTube search budget is spent at most once per
        // artist ever.
        await supabase
          .from("artists")
          .upsert(toArtistRow(attraction), { onConflict: "tm_attraction_id" });
      }
    } catch (error) {
      // A Ticketmaster outage should not lose the user's confirmation; the
      // printed-genre signal and the artist preferences still apply.
      warning = `Artists were saved, but Ticketmaster lookup failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  } else if (!input.ticketmasterApiKey) {
    warning =
      "TICKETMASTER_API_KEY is not set, so genres could not be inferred from the artists.";
  }

  // Persist the resolved artists against the feed, for the UI to show.
  if (deduped.length > 0) {
    await supabase.from("feed_artists").upsert(
      deduped.map((artist) => ({
        feed_id: feedId,
        name: artist.name,
        normalized_name: artist.normalized,
        role: artist.role,
        tm_attraction_id: artist.tmAttractionId ?? null,
      })),
      { onConflict: "feed_id,normalized_name" },
    );
  }

  // Artist preferences. A headliner on a flyer someone saved is a stronger
  // signal than a name buried in the support slot.
  for (const artist of deduped) {
    const increment = artist.role === "support" ? 0.5 : 1;

    const { data: existing } = await supabase
      .from("artist_prefs")
      .select("id, score")
      .eq("user_id", userId)
      .eq("normalized_name", artist.normalized)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("artist_prefs")
        .update({
          score: Number(existing.score) + increment,
          last_seen_at: new Date().toISOString(),
          tm_attraction_id: artist.tmAttractionId ?? null,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("artist_prefs").insert({
        user_id: userId,
        name: artist.name,
        normalized_name: artist.normalized,
        tm_attraction_id: artist.tmAttractionId ?? null,
        score: increment,
        source: "feed",
      });
    }
  }

  // Genre preferences — insert only, never update.
  const genresAdded: string[] = [];
  if (matchedGenreIds.size > 0) {
    const { data: existingPrefs } = await supabase
      .from("genre_prefs")
      .select("genre_id")
      .eq("user_id", userId)
      .in("genre_id", [...matchedGenreIds]);

    const alreadyDecided = new Set(
      (existingPrefs ?? []).map((row) => row.genre_id as number),
    );

    const toInsert = [...matchedGenreIds].filter(
      (genreId) => !alreadyDecided.has(genreId),
    );

    if (toInsert.length > 0) {
      await supabase.from("genre_prefs").insert(
        toInsert.map((genreId) => ({
          user_id: userId,
          genre_id: genreId,
          source: "feed" as const,
          weight: 0.6,
        })),
      );
      const nameById = new Map(genres.map((genre) => [genre.id, genre.name]));
      for (const genreId of toInsert) {
        const name = nameById.get(genreId);
        if (name) genresAdded.push(name);
      }
    }
  }

  await supabase
    .from("feeds")
    .update({ applied_at: new Date().toISOString() })
    .eq("id", feedId)
    .eq("user_id", userId);

  return {
    artistsLearned: deduped.length,
    genresAdded,
    artistsResolved,
    warning,
  };
}

type WorkingArtist = ConfirmedArtist & {
  normalized: string;
  tmAttractionId?: string;
};

/**
 * Collapses duplicates by normalised name, keeping the strongest role.
 *
 * A flyer can legitimately print the same act twice (headline banner plus a
 * schedule line), and the two spellings may differ by punctuation or accent.
 */
function dedupeArtists(artists: ConfirmedArtist[]): WorkingArtist[] {
  const byName = new Map<string, WorkingArtist>();

  for (const artist of artists) {
    const name = artist.name.trim();
    if (name.length < 2) continue;
    const normalized = normalizeName(name);
    if (!normalized) continue;

    const existing = byName.get(normalized);
    if (!existing) {
      byName.set(normalized, { name, role: artist.role, normalized });
      continue;
    }
    if (existing.role !== "headliner" && artist.role === "headliner") {
      existing.role = "headliner";
    }
  }

  return [...byName.values()];
}
