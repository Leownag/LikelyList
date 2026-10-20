/**
 * Turning Census Gazetteer rows into something a search box can use.
 *
 * Lives in src/ rather than in the seeder because it is domain logic with judgement
 * in it — which of two Portlands to offer first — and that deserves tests. The
 * seeder imports from here, the same arrangement as lib/logo.ts and
 * scripts/build-logo.ts.
 */

/**
 * The metros in `cities`, which should surface first when a name collides.
 *
 * A name+state set rather than a database read, so seeding places never depends on
 * having seeded cities.
 *
 * Brooklyn is intentionally absent from the results this matches: it is a New York
 * City borough, not a Census place, so no row exists to rank. It remains a curated
 * city for subscriptions.
 */
export const MAJOR_PLACE_KEYS = new Set([
  "boston, ma", "new york, ny", "brooklyn, ny", "philadelphia, pa",
  "washington, dc", "baltimore, md", "pittsburgh, pa", "buffalo, ny",
  "providence, ri", "chicago, il", "detroit, mi", "milwaukee, wi",
  "minneapolis, mn", "cleveland, oh", "columbus, oh", "cincinnati, oh",
  "indianapolis, in", "st. louis, mo", "kansas city, mo", "atlanta, ga",
  // Its Census name really is Nashville-Davidson, so that is what gets stored and
  // what has to be listed here. "nashville, tn" is kept because a prefix search for
  // "nashville" still needs to reach it.
  "nashville, tn", "nashville-davidson, tn",
  "charlotte, nc", "raleigh, nc", "richmond, va",
  "new orleans, la", "miami, fl", "orlando, fl", "tampa, fl",
  "austin, tx", "dallas, tx", "houston, tx", "denver, co",
  "salt lake city, ut", "phoenix, az", "las vegas, nv", "los angeles, ca",
  "san diego, ca", "san francisco, ca", "oakland, ca", "san jose, ca",
  "sacramento, ca", "portland, or", "seattle, wa",
]);

/**
 * Census LSAD codes worth preferring, best first.
 *
 * An incorporated city outranks a Census-designated place, which is a statistical
 * boundary rather than a government. When "Portland" matches both, the city is
 * almost certainly what was meant.
 */
const LSAD_RANK: Record<string, number> = {
  "25": 0, // city
  "43": 1, // town
  "47": 2, // village
  "21": 3, // borough
  "57": 6, // CDP
};

/**
 * How a place is written for a reader: "Cambridge, MA".
 *
 * One function because it was previously open-coded in eight places, and the
 * seeded `cities` row for Washington carried its state inside `name` *and* in
 * `state_code`. Two of those call sites joined with ", " and produced
 * "Washington, DC, DC"; the chip grid rendered name and state as adjacent
 * elements with no separator and produced "Washington, DC DC". One bad row, two
 * different wrong answers, because nothing owned the question.
 *
 * The seed is fixed too, but the guard stays: rows written before that fix are
 * still in the database, and `subscriptions.place_name` copies the name at
 * subscribe time rather than joining to it.
 */
export function placeLabel(
  name: string | null | undefined,
  stateCode: string | null | undefined,
): string {
  const place = (name ?? "").trim();
  const state = (stateCode ?? "").trim();
  if (!place) return state;
  if (!state) return place;
  // Case-insensitive because the column is free text, not an enum.
  if (place.toUpperCase().endsWith(`, ${state.toUpperCase()}`)) return place;
  return `${place}, ${state}`;
}

/** Lowercased "name, st". The seeded column a prefix search runs against. */
export function placeSearchKey(name: string, stateCode: string): string {
  return `${name}, ${stateCode}`.toLowerCase();
}

/**
 * Strips the Census type suffix from a place name.
 *
 * The file says "Abanda CDP" and "Boston city"; somebody typing into a search box
 * expects "Abanda" and "Boston". The suffix's information is not lost — it goes into
 * the rank instead.
 *
 * Two ordered passes rather than one, because the Gazetteer stacks these:
 * "Indianapolis city (balance)" and "Nashville-Davidson metropolitan government
 * (balance)". A single pass removed only "(balance)" and left the rest, which is how
 * Indianapolis ended up stored as "Indianapolis city".
 *
 * And deliberately not a loop. "Kansas City city" must become "Kansas City", not
 * "Kansas" — the second "City" is part of the name. Removing "(balance)" and then at
 * most one type suffix handles the stacked cases without ever eating a real word.
 */
const BALANCE_SUFFIX = /\s*\(balance\)$/i;
const TYPE_SUFFIX =
  /\s+(CDP|city|town|village|borough|municipality|township|comunidad|zona urbana|consolidated government|metropolitan government|urban county)$/i;

/**
 * A second designator, once the first has gone.
 *
 * The Gazetteer doubles up: Massachusetts has "Amherst Town city", which the pass
 * above reduces to "Amherst Town" and stops. "City" is deliberately excluded here
 * because it is the one designator that is also a real part of names — Kansas City,
 * Salt Lake City, Oklahoma City — whereas a trailing standalone "Town" or "Village"
 * is always Census bookkeeping.
 */
const SECOND_SUFFIX =
  /\s+(town|village|borough|township|municipality)$/i;

export function cleanPlaceName(raw: string): string {
  return raw
    .replace(BALANCE_SUFFIX, "")
    .replace(TYPE_SUFFIX, "")
    .replace(SECOND_SUFFIX, "")
    .trim();
}

/**
 * Ordering hint for the typeahead, lower first.
 *
 * Assembled from what the Gazetteer actually carries, because it has no population
 * column and the Census population API now requires a registered key. So: curated
 * metros, then incorporated places over statistical ones, then land area as a weak
 * tiebreak. This is a proxy and should not be read as a popularity ranking.
 */
export function placeRank(
  searchKey: string,
  lsad: string,
  areaSqMi: number,
): number {
  if (MAJOR_PLACE_KEYS.has(searchKey)) return 0;

  const base = 10 + (LSAD_RANK[lsad] ?? 8) * 100;
  // Larger first within a band, bounded so a sprawling rural place cannot climb into
  // the band above.
  //
  // NaN is handled here rather than left to the caller. `rank` is an integer column,
  // so a NaN would fail the insert — and because the seeder writes in chunks of a
  // thousand, one malformed area figure would take out a thousand good rows with it.
  const area = Number.isFinite(areaSqMi) ? areaSqMi : 0;
  const areaBonus = Math.min(Math.max(Math.round(area), 0), 90);
  return base + (90 - areaBonus);
}
