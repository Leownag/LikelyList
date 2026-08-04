import type { TmClient } from "./client";
import {
  MUSIC_SEGMENT_ID,
  type TmClassificationsResponse,
  type TmSegmentNode,
} from "./types";
import { normalizeName } from "@/lib/normalize";
import { byGenrePopularity } from "./genre-ranking";

/**
 * Music genre enumeration.
 *
 * Ticketmaster does not publish a table of music genre IDs, and third-party
 * write-ups disagree with each other about which ID means which genre — I found
 * two sources giving different IDs for "Rock". So the taxonomy is always read
 * from the live API and stored, never hardcoded. The only ID taken on faith is
 * the Music segment itself, which the official docs do state.
 */

export type MusicGenre = {
  tmGenreId: string;
  tmSegmentId: string;
  name: string;
  slug: string;
};

export async function fetchMusicGenres(client: TmClient): Promise<MusicGenre[]> {
  const genres = new Map<string, MusicGenre>();
  const pageSize = 20;

  for (let page = 0; page < 20; page++) {
    const response = await client.get<TmClassificationsResponse>(
      "/classifications.json",
      { size: pageSize, page },
    );

    const rows = response._embedded?.classifications ?? [];
    for (const row of rows) {
      const segment: TmSegmentNode | undefined = row.segment;
      if (!segment || segment.id !== MUSIC_SEGMENT_ID) continue;

      for (const genre of segment._embedded?.genres ?? []) {
        if (!genre.id || !genre.name) continue;
        // "Undefined" and "Other" are real entries in the taxonomy but useless
        // as something a person would choose to follow.
        if (/^(undefined|other|unknown)$/i.test(genre.name)) continue;

        genres.set(genre.id, {
          tmGenreId: genre.id,
          tmSegmentId: segment.id,
          name: genre.name,
          slug: normalizeName(genre.name).replace(/ /g, "-"),
        });
      }
    }

    const totalPages = response.page?.totalPages ?? 0;
    if (rows.length < pageSize || page + 1 >= totalPages) break;
  }

  // Ranked here rather than at the call sites, so the seed script and the weekly
  // taxonomy refresh cannot drift into different orders.
  return [...genres.values()].sort(byGenrePopularity);
}
