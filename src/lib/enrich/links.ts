/**
 * Outbound links for an artist.
 *
 * Spotify is reached by a search deep link rather than through its API. That is
 * a deliberate constraint, not a shortcut: since February 2026 a Spotify app in
 * Development Mode stops working unless its owner holds an active Premium
 * subscription, which would tie this site's core feature to a personal paid
 * plan. A search URL costs nothing, cannot break, and lands the reader on the
 * artist in one tap.
 *
 * The side effect is that no artist artwork comes from Spotify — which is
 * fortunate for email, because Spotify's own image URLs are short-lived CDN
 * links that expire, and an email sits in an inbox for weeks. All thumbnails
 * come from Ticketmaster's CDN instead.
 */

export function spotifySearchUrl(artistName: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(artistName.trim())}`;
}

/**
 * Zero-quota YouTube link.
 *
 * Used both as the default and as the fallback once the daily search budget is
 * spent — see ./youtube for why that budget is only 100 calls a day.
 */
export function youtubeSearchUrl(artistName: string): string {
  const query = encodeURIComponent(`${artistName.trim()} live`);
  return `https://www.youtube.com/results?search_query=${query}`;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function youtubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
}

/**
 * Thumbnail for a video, built from the ID with no API call.
 *
 * `hqdefault` on purpose: `maxresdefault` 404s unpredictably on older and
 * lower-resolution uploads, and a broken image in an email cannot be retried
 * once it has been delivered.
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

/**
 * Whether a URL read off a flyer is safe to render as a link.
 *
 * `ticket_url` comes out of an image, so it is untrusted: anything that is not
 * plainly http(s) — `javascript:`, `data:`, a bare fragment — is discarded
 * rather than sanitised.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
