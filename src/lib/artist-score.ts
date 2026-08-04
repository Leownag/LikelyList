/**
 * The one scale every artist signal is expressed on.
 *
 * Three places used to hold their own opinion about these numbers —
 * `feeds/apply.ts`, `subscriptions/actions.ts` and `spotify/import.ts` — and they only
 * make sense relative to each other, so a change in one silently reordered somebody's
 * digest. They live here now.
 *
 * The scale is read by `buildDigest` as `genreWeight + 3 × min(artistBoost, 3)`, where
 * artistBoost is the sum of the scores of every followed artist on the bill. So the
 * numbers below are not arbitrary: the ×3 means one followed artist outranks any genre
 * match, and the cap at 3 stops a single artist owning the whole week.
 */

/**
 * Typing a name into the search box.
 *
 * The ceiling, because it is the least ambiguous thing a reader can do. Everything else
 * is inference — from a screenshot, or from listening history — and inference should not
 * be able to outrank a statement.
 */
export const EXPLICIT_ARTIST_SCORE = 1.5;

/**
 * Spotify's top artists, tapered by rank.
 *
 * Below EXPLICIT deliberately: listening a lot is strong evidence and still weaker than
 * saying so. The taper preserves the order Spotify already gave us, which costs nothing
 * and means a #2 artist outranks a #47 one.
 */
export const SPOTIFY_TOP_SCORE = 1.4;
export const SPOTIFY_BOTTOM_SCORE = 0.6;

/**
 * What one screenshot sighting is worth, by how prominent the name looked.
 *
 * `unknown` sits between the two: the model could not tell, and leaning towards
 * "meaningful" is the kinder error when the alternative is ignoring somebody's
 * favourite band.
 */
export const FEED_PROMINENCE_WEIGHT: Record<string, number> = {
  primary: 1,
  mentioned: 0.4,
  unknown: 0.7,
};

/**
 * The ceiling a feed-derived artist converges on, however many times they are seen.
 *
 * Screenshot scores accumulate — each sighting adds its weight — which is right, because
 * seeing a name five times across five screenshots really is stronger evidence than
 * seeing it once. What was wrong is that it accumulated without a bound: uploading the
 * same library screenshot ten times pushed one artist to 10, and since buildDigest caps
 * the *total* artist contribution at 3, that one artist then satisfied the cap alone and
 * crowded everything else out of the week. The reader would never report it as a bug —
 * they would just notice the digest got worse.
 *
 * Set to EXPLICIT so repeated evidence converges on "as strong as you saying it
 * yourself", and never stronger.
 */
export const FEED_ARTIST_SCORE_CAP = EXPLICIT_ARTIST_SCORE;

/**
 * The next score for an artist seen again in a screenshot.
 *
 * Pure so the accumulation rule is testable, which matters because the bug it fixes is
 * invisible until a digest is already bad.
 */
export function accumulateFeedScore(
  existingScore: number,
  prominence: string | null | undefined,
): number {
  const weight = FEED_PROMINENCE_WEIGHT[prominence ?? "unknown"] ?? 0.7;
  const existing = Number.isFinite(existingScore) ? existingScore : 0;
  return Math.min(Math.max(existing, 0) + weight, FEED_ARTIST_SCORE_CAP);
}

/**
 * The score for an artist at `index` in a Spotify top list of `total`.
 *
 * Guards the single-artist case: the taper divides by (total - 1), and a new account
 * really can come back with one artist, which produced NaN — and NaN fails the insert.
 */
export function spotifyRankScore(index: number, total: number): number {
  const step =
    total > 1 ? (SPOTIFY_TOP_SCORE - SPOTIFY_BOTTOM_SCORE) / (total - 1) : 0;
  return Number((SPOTIFY_TOP_SCORE - step * index).toFixed(3));
}
