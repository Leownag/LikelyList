import type { AdminClient } from "@/lib/supabase/admin";
import { USAGE_YOUTUBE_SEARCH, type ArtistRow } from "@/lib/db";
import {
  youtubeChannelUrl,
  youtubeSearchUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "./links";

/**
 * YouTube enrichment, built around one hard constraint.
 *
 * Since 1 June 2026 `search.list` no longer costs 100 units from the shared
 * 10,000-unit pool — it costs 1 unit from its own bucket, capped at **100 calls
 * per day** for the whole project. That ceiling cannot be bought past with unit
 * efficiency, so the only workable strategy is: an artist costs at most one
 * search *ever*.
 *
 * Channel IDs do not change, so the mapping is cached permanently on the artist
 * row. Everything after the initial search comes from the 10,000-unit pool at
 * 1 unit a call, which at this project's volume is effectively free:
 *   channels.list      -> the uploads playlist
 *   playlistItems.list -> the latest upload, fresh every week, for 1 unit
 *
 * When the budget is exhausted the digest degrades to a zero-quota search deep
 * link rather than failing or dropping the artist.
 */

const API = "https://www.googleapis.com/youtube/v3";

export type ArtistLinks = {
  /** Best available YouTube destination. Never null — falls back to a search. */
  youtubeUrl: string;
  /** Only present when we resolved an actual video. */
  youtubeThumbnailUrl: string | null;
};

export type YoutubeBudget = {
  /** Returns true if a search.list call may be spent. */
  claim(): Promise<boolean>;
  spent(): number;
};

/**
 * Daily search budget, counted in the database so it holds across invocations.
 *
 * The weekly digest runs as many short Worker invocations, so an in-process
 * counter would reset constantly and quietly blow through the real API ceiling.
 */
export function createYoutubeBudget(
  supabase: AdminClient,
  day: string,
  limit: number,
): YoutubeBudget {
  let spent = 0;

  return {
    async claim() {
      const { data, error } = await supabase.rpc("bump_global_usage", {
        p_kind: USAGE_YOUTUBE_SEARCH,
        p_day: day,
        p_amount: 1,
      });
      if (error) return false;
      if (typeof data === "number" && data > limit) return false;
      spent += 1;
      return true;
    },
    spent: () => spent,
  };
}

type SearchResponse = {
  items?: {
    id?: { kind?: string; channelId?: string; videoId?: string };
    snippet?: { channelId?: string; title?: string };
  }[];
};

type ChannelsResponse = {
  items?: {
    id?: string;
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }[];
};

type PlaylistItemsResponse = {
  items?: { snippet?: { resourceId?: { videoId?: string } } }[];
};

async function call<T>(
  apiKey: string,
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

/**
 * Resolves the best YouTube link for one artist, spending quota only if needed.
 *
 * `artist` may be a cached row (the common case after the first week) or null
 * when the artist is not in our cache at all.
 */
export async function resolveYoutube(
  {
    apiKey,
    supabase,
    budget,
  }: { apiKey: string; supabase: AdminClient; budget: YoutubeBudget },
  artistName: string,
  artist: Pick<
    ArtistRow,
    | "tm_attraction_id"
    | "youtube_channel_id"
    | "youtube_uploads_playlist_id"
    | "youtube_video_id"
    | "youtube_looked_up_at"
  > | null,
): Promise<ArtistLinks> {
  const fallback: ArtistLinks = {
    youtubeUrl: youtubeSearchUrl(artistName),
    youtubeThumbnailUrl: null,
  };

  if (!apiKey) return fallback;

  let channelId = artist?.youtube_channel_id ?? null;
  let uploadsPlaylistId = artist?.youtube_uploads_playlist_id ?? null;

  // Never search twice for the same artist. `youtube_looked_up_at` is set even
  // when the search found nothing, so a miss does not keep costing quota.
  if (!channelId && !artist?.youtube_looked_up_at) {
    if (!(await budget.claim())) return fallback;

    const search = await call<SearchResponse>(apiKey, "/search", {
      part: "snippet",
      type: "channel",
      maxResults: "1",
      q: artistName,
      fields: "items(id/channelId)",
    });

    channelId = search?.items?.[0]?.id?.channelId ?? null;

    if (artist?.tm_attraction_id) {
      await supabase
        .from("artists")
        .update({
          youtube_channel_id: channelId,
          youtube_looked_up_at: new Date().toISOString(),
        })
        .eq("tm_attraction_id", artist.tm_attraction_id);
    }
  }

  if (!channelId) return fallback;

  // 1 unit, and it also gives us the uploads playlist we need next.
  if (!uploadsPlaylistId) {
    const channels = await call<ChannelsResponse>(apiKey, "/channels", {
      part: "contentDetails",
      id: channelId,
      fields: "items(contentDetails/relatedPlaylists/uploads)",
    });
    uploadsPlaylistId =
      channels?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;

    if (uploadsPlaylistId && artist?.tm_attraction_id) {
      await supabase
        .from("artists")
        .update({ youtube_uploads_playlist_id: uploadsPlaylistId })
        .eq("tm_attraction_id", artist.tm_attraction_id);
    }
  }

  if (!uploadsPlaylistId) {
    return { youtubeUrl: youtubeChannelUrl(channelId), youtubeThumbnailUrl: null };
  }

  // 1 unit for the channel's latest upload — a fresh video every week without
  // ever touching the search bucket again.
  const uploads = await call<PlaylistItemsResponse>(apiKey, "/playlistItems", {
    part: "snippet",
    playlistId: uploadsPlaylistId,
    maxResults: "1",
    fields: "items(snippet/resourceId/videoId)",
  });

  const videoId = uploads?.items?.[0]?.snippet?.resourceId?.videoId ?? null;

  if (!videoId) {
    return { youtubeUrl: youtubeChannelUrl(channelId), youtubeThumbnailUrl: null };
  }

  if (artist?.tm_attraction_id) {
    await supabase
      .from("artists")
      .update({ youtube_video_id: videoId })
      .eq("tm_attraction_id", artist.tm_attraction_id);
  }

  return {
    youtubeUrl: youtubeWatchUrl(videoId),
    youtubeThumbnailUrl: youtubeThumbnailUrl(videoId),
  };
}
