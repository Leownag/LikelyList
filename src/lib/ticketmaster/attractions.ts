import type { TmClient } from "./client";
import type { TmAttraction, TmAttractionsResponse } from "./types";
import { MUSIC_SEGMENT_ID } from "./types";
import { externalLink, pickImage, primaryClassification } from "./lineup";
import { normalizeName } from "@/lib/normalize";
import type { ArtistRow } from "@/lib/db";

/**
 * Attraction (performer) lookup.
 *
 * Note what this endpoint cannot do: it accepts no city, geo or date
 * parameters. "Who is playing my city this week" is therefore only answerable
 * from /events — attraction search is purely for resolving a name a user gave
 * us (from a feed) into a Ticketmaster identity.
 */

/**
 * Best match for a free-text artist name, or null.
 *
 * `keyword` does not match partial words — the docs are explicit that
 * "keyword=Mado will not found event with name: Madonna" — so this is only ever
 * as good as the name the extractor read off the poster.
 */
export async function findAttractionByName(
  client: TmClient,
  name: string,
): Promise<TmAttraction | null> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;

  const response = await client.get<TmAttractionsResponse>(
    "/attractions.json",
    {
      keyword: trimmed,
      segmentId: MUSIC_SEGMENT_ID,
      size: 10,
      sort: "relevance,desc",
      includeTest: "no",
    },
  );

  const candidates = (response._embedded?.attractions ?? []).filter(
    (a) => !a.test,
  );
  if (candidates.length === 0) return null;

  const target = normalizeName(trimmed);

  // Prefer an exact normalised match over whatever relevance ranked first —
  // a search for "Turnstile" should not return a tribute band because it
  // happened to rank higher.
  const exact = candidates.find((candidate) => {
    const names = [candidate.name, ...(candidate.aliases ?? [])];
    return names.some((n) => normalizeName(n) === target);
  });

  return exact ?? candidates[0];
}

/** Flattens an attraction into the cache row, minus the YouTube columns. */
export function toArtistRow(
  attraction: TmAttraction,
): Omit<
  ArtistRow,
  | "youtube_channel_id"
  | "youtube_uploads_playlist_id"
  | "youtube_video_id"
  | "youtube_looked_up_at"
> {
  return {
    tm_attraction_id: attraction.id,
    name: attraction.name,
    normalized_name: normalizeName(attraction.name),
    tm_url: attraction.url ?? null,
    image_url: pickImage(attraction.images, { maxWidth: 320, ratio: "3_2" }),
    tm_genre_id: primaryClassification(attraction).genreId,
    external_links: attraction.externalLinks ?? null,
    refreshed_at: new Date().toISOString(),
  };
}

/**
 * A YouTube URL Ticketmaster already knows about, if any.
 *
 * Worth checking before spending YouTube search quota: the provider keys are
 * undocumented, so several spellings are tried and absence is the common case.
 */
export function youtubeLinkFrom(attraction: TmAttraction): string | null {
  return externalLink(attraction, ["youtube", "youtube_channel", "yt"]);
}

/** Likewise for Spotify, which we otherwise reach only via a search link. */
export function spotifyLinkFrom(attraction: TmAttraction): string | null {
  return externalLink(attraction, ["spotify", "spotify_artist"]);
}

export function homepageFrom(attraction: TmAttraction): string | null {
  return externalLink(attraction, ["homepage", "website", "wiki"]);
}
