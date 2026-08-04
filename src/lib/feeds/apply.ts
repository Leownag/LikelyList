import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName } from "@/lib/normalize";
import { accumulateFeedScore } from "@/lib/artist-score";
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
 *
 * Sized for the real input. A "top artists" screen or a long playlist routinely
 * yields dozens of names, so two things are bounded here:
 *
 *   - Ticketmaster resolution is capped and prioritised. It is throttled to 5
 *     requests a second and shares a 5000/day budget with the weekly digest, so
 *     resolving 50 names serially would make the user wait a quarter of a minute
 *     and spend 1% of the day's quota on one screenshot.
 *   - Preference writes are batched. The first version did a SELECT and an
 *     UPDATE per artist; 50 artists meant 100 sequential round trips.
 */

/** Artists kept from one screenshot. Beyond this, the tail adds noise. */
const MAX_ARTISTS_PER_FEED = 40;

/**
 * How many artists get a Ticketmaster lookup, in prominence order.
 *
 * Only used to infer genres, and the printed-genre signal covers much of that
 * anyway — so the marginal value of the 13th lookup is low and its cost is real.
 */
const MAX_TM_LOOKUPS_PER_FEED = 12;

export type ConfirmedArtist = {
  name: string;
  /**
   * How central the act was on the screenshot. See lib/vision/schema.ts —
   * "primary" means presented as an artist in its own right, "mentioned" means it
   * only appeared as the performer of a listed track.
   */
  prominence: "primary" | "mentioned" | null;
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
  /** How many names were discarded by MAX_ARTISTS_PER_FEED. */
  droppedForCap: number;
  /** Set when Ticketmaster lookup was capped, skipped or failed; not fatal. */
  warning?: string;
};

export async function applyFeed(
  supabase: SupabaseClient,
  input: ApplyInput,
): Promise<ApplyResult> {
  const { userId, feedId, artists, printedGenres } = input;

  const allDeduped = dedupeArtists(artists);
  // Truncated after deduping and sorting so the cap keeps the *most prominent*
  // names rather than whichever the model happened to list first.
  const deduped = allDeduped
    .sort((a, b) => prominenceRank(a.prominence) - prominenceRank(b.prominence))
    .slice(0, MAX_ARTISTS_PER_FEED);
  const droppedForCap = allDeduped.length - deduped.length;

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

      // Bounded, and in prominence order. `deduped` is already sorted, so this
      // spends the budget on the acts the screenshot actually featured.
      const toResolve = deduped.slice(0, MAX_TM_LOOKUPS_PER_FEED);
      const artistRows: ReturnType<typeof toArtistRow>[] = [];

      for (const artist of toResolve) {
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

        artistRows.push(toArtistRow(attraction));
      }

      // One upsert instead of one per artist. Caches them so the weekly
      // enrichment does not look them up again, and so the YouTube search budget
      // is spent at most once per artist ever.
      if (artistRows.length > 0) {
        await supabase
          .from("artists")
          .upsert(artistRows, { onConflict: "tm_attraction_id" });
      }

      if (deduped.length > toResolve.length) {
        warning = `Genres were inferred from the first ${toResolve.length} artists; the rest were saved without a Ticketmaster lookup.`;
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
        prominence: artist.prominence,
        tm_attraction_id: artist.tmAttractionId ?? null,
      })),
      { onConflict: "feed_id,normalized_name" },
    );
  }

  // Artist preferences. "I follow this artist" is a stronger statement of taste
  // than "one of their songs is in a playlist I screenshotted", so a name that
  // only turned up beside a track counts for less.
  //
  // One read and one write for the whole set. The previous shape was a SELECT and
  // an UPDATE per artist, which on a 40-name screenshot meant 80 sequential round
  // trips with the user waiting on the response.
  if (deduped.length > 0) {
    const { data: existingRows } = await supabase
      .from("artist_prefs")
      .select("normalized_name, score")
      .eq("user_id", userId)
      .in(
        "normalized_name",
        deduped.map((artist) => artist.normalized),
      );

    const scoreByName = new Map(
      ((existingRows ?? []) as { normalized_name: string; score: number }[]).map(
        (row) => [row.normalized_name, Number(row.score)],
      ),
    );

    const now = new Date().toISOString();
    await supabase.from("artist_prefs").upsert(
      deduped.map((artist) => ({
        user_id: userId,
        name: artist.name,
        normalized_name: artist.normalized,
        tm_attraction_id: artist.tmAttractionId ?? null,
        // The increment is computed here because a Postgres upsert cannot do
        // `score = score + n` through PostgREST.
        // Accumulates across sightings, but bounded — see accumulateFeedScore. Without
        // the bound, re-uploading one screenshot pushed a single artist high enough to
        // satisfy buildDigest's artist cap alone and crowd out the rest of the week.
        score: accumulateFeedScore(
          scoreByName.get(artist.normalized) ?? 0,
          artist.prominence,
        ),
        source: "feed" as const,
        last_seen_at: now,
      })),
      { onConflict: "user_id,normalized_name" },
    );
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
    droppedForCap,
    warning:
      droppedForCap > 0
        ? [
            `Kept the ${deduped.length} most prominent artists and skipped ${droppedForCap} more from that screenshot.`,
            warning,
          ]
            .filter(Boolean)
            .join(" ")
        : warning,
  };
}


/** Sort key: primary first, then unknown, then mentioned. */
function prominenceRank(prominence: ConfirmedArtist["prominence"]): number {
  if (prominence === "primary") return 0;
  if (prominence === null) return 1;
  return 2;
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
      byName.set(normalized, { name, prominence: artist.prominence, normalized });
      continue;
    }
    // An act that appears both as an artist tile and beside a track keeps the
    // stronger reading.
    if (existing.prominence !== "primary" && artist.prominence === "primary") {
      existing.prominence = "primary";
    }
  }

  return [...byName.values()];
}
