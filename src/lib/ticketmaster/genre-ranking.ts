import { normalizeName } from "@/lib/normalize";

/**
 * Display order for music genres.
 *
 * Ticketmaster exposes no popularity, listing-count or ranking signal on the
 * classifications endpoint, and alphabetical order is actively bad here: it puts
 * Alternative, Blues and Classical in front of Rock, Pop and Hip-Hop, so the
 * three genres most people want are below the fold.
 *
 * So this is a hand-ranked list, ordered roughly by how much live inventory each
 * genre actually has in US listings. It is a judgement call, not a measurement —
 * stated plainly because someone will otherwise assume it came from an API.
 *
 * Matching is on the normalised name rather than the ID, because Ticketmaster
 * does not publish stable genre IDs (see scripts/seed-genres.ts). Anything not
 * listed here keeps a stable alphabetical position after everything that is, so
 * a taxonomy change can never drop a genre from the picker.
 */
const RANKED_GENRE_NAMES = [
  "Rock",
  "Pop",
  "Hip-Hop/Rap",
  "Country",
  "Dance/Electronic",
  "Alternative",
  "Metal",
  "R&B",
  "Latin",
  "Indie",
  "Folk",
  "Punk",
  "Jazz",
  "Blues",
  "Reggae",
  "Classical",
  "Electronic",
  "World",
  "Soul",
  "Funk",
  "Gospel",
  "Religious",
  "New Age",
  "Holiday",
  "Children's Music",
] as const;

/**
 * Alternate spellings seen in the wild for the same genre, so a rename on
 * Ticketmaster's side does not silently demote a major genre to the tail.
 */
const ALIASES: Record<string, string> = {
  // Keys and values are already normalised. Only genuine synonyms belong here —
  // the canonical spellings resolve directly.
  "hip hop": "hip hop rap",
  rap: "hip hop rap",
  "electronic dance": "dance electronic",
  edm: "dance electronic",
  rnb: "r and b",
  "rhythm and blues": "r and b",
  "hard rock metal": "metal",
  "heavy metal": "metal",
  "indie rock": "indie",
  "alternative rock": "alternative",
};

/** Normalised name -> rank. Lower sorts first. */
const RANK_BY_NAME = new Map<string, number>(
  RANKED_GENRE_NAMES.map((name, index) => [normalizeName(name), index]),
);

function rankOf(name: string): number {
  const normalized = normalizeName(name);
  const canonical = ALIASES[normalized] ?? normalized;
  return RANK_BY_NAME.get(canonical) ?? Number.POSITIVE_INFINITY;
}

/**
 * Sorts by the curated ranking, then alphabetically for anything unranked.
 *
 * Stable and total, so re-seeding an unchanged taxonomy produces identical
 * sort_order values rather than reshuffling the picker.
 */
export function byGenrePopularity<T extends { name: string }>(a: T, b: T): number {
  const rankA = rankOf(a.name);
  const rankB = rankOf(b.name);
  if (rankA !== rankB) return rankA - rankB;
  return a.name.localeCompare(b.name);
}

/** Exposed for the test, and so the ranking can be inspected without importing internals. */
export function genreRank(name: string): number {
  return rankOf(name);
}
