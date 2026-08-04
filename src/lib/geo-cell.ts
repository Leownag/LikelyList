/**
 * Grouping nearby subscribers into one Ticketmaster query.
 *
 * A subscription stores coordinates, not a city — the city name is a label. That is
 * what lets anybody follow any of the 32,329 US places, but it creates a cost problem:
 * the weekly planner made one API call per distinct subscribed *city*, and one call per
 * distinct *point* would mean two people in neighbouring suburbs paying twice for
 * results that overlap almost entirely.
 *
 * So points are rounded onto a fixed grid, and the planner queries once per occupied
 * cell. Two subscribers in the same cell share a call. The rounded point is *also* the
 * query centre and the cache key, which is the property that makes this simple: there
 * is no separate "representative point" to pick, and no ambiguity about which of two
 * subscribers in a cell the search was centred on.
 *
 * Why a grid and not a geohash: a geohash string cannot be turned back into a centre
 * without a decoder, and this needs the centre. A rounded pair is reversible by
 * construction and — the reason that matters — computable in SQL, so migration 0014 can
 * backfill existing rows without running application code.
 */

/**
 * Grid resolution in degrees.
 *
 * A quarter degree is about 28 km north-south, and 20 km east-west at US latitudes. So
 * a point sits at most ~0.18° — roughly 20 km — from its cell centre.
 *
 * Read against the 50-mile (80 km) search radius, that means a subscriber near a cell
 * corner effectively gets 50 miles in one direction and closer to 38 in another. That
 * is the trade being made, and it is the right way round: the alternative is exact
 * per-point queries, whose cost grows with how spread out subscribers are, against a
 * 5000/day quota the weekly send depends on.
 *
 * Halving this quarters the sharing and quadruples the calls. Do not change it without
 * looking at how many distinct cells the subscriber base actually occupies.
 */
export const GEO_CELL_DEGREES = 0.25;

const STEPS_PER_DEGREE = 1 / GEO_CELL_DEGREES;

/**
 * The centre of the cell a point falls in.
 *
 * Rounded rather than floored so the centre is the nearest grid point, which halves the
 * worst-case distance compared with taking a corner.
 */
export function geoCellCentre(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } {
  return {
    latitude: roundToGrid(latitude),
    longitude: roundToGrid(longitude),
  };
}

/**
 * The cell key: `"42.25,-71"`.
 *
 * A string because it is a database key and a Map key, and because two floats that
 * should be equal are a bad thing to compare. Kept human-readable on purpose — a cell
 * in a log or a cache row should be somewhere you can look up on a map.
 */
export function geoCellKey(latitude: number, longitude: number): string {
  const centre = geoCellCentre(latitude, longitude);
  return `${format(centre.latitude)},${format(centre.longitude)}`;
}

/** The centre back out of a key, for the planner's query. */
export function parseGeoCellKey(
  key: string,
): { latitude: number; longitude: number } | null {
  const parts = key.split(",");
  if (parts.length !== 2) return null;

  // Emptiness is checked before Number(), because `Number("")` is 0 rather than NaN —
  // so "42.25," would otherwise parse as a point in the Atlantic instead of being
  // rejected, and the planner would run a real search centred on it.
  if (parts.some((part) => part.trim() === "")) return null;

  const [latitude, longitude] = parts.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
}

function roundToGrid(value: number): number {
  // The multiply/divide keeps the result on exact grid points rather than accumulating
  // float error, and normalises -0 to 0 so the key never reads "-0".
  const snapped = Math.round(value * STEPS_PER_DEGREE) / STEPS_PER_DEGREE;
  return snapped === 0 ? 0 : snapped;
}

/**
 * Trailing zeros trimmed, so one cell has exactly one key.
 *
 * `42.25` and `42.250` are the same cell and must not become two rows.
 */
function format(value: number): string {
  return String(Number(value.toFixed(2)));
}
