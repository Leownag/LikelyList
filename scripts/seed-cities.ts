/**
 * Seeds public.cities.
 *
 * Run with: npm run seed:cities
 *
 * A curated list rather than "every city Ticketmaster knows": the weekly cron
 * makes one API call per DISTINCT subscribed city, so the set of selectable
 * cities is directly a quota decision (5000 requests/day). These are US markets
 * with enough listed inventory to fill a weekly digest.
 *
 * `tm_city` is what gets handed to Ticketmaster's `city` parameter. It is kept
 * separate from `name` because the two are not always the same string, and
 * because `keyword`-style partial matching does not apply here.
 */

import { adminClientFromProcessEnv } from "./_shared";

type SeedCity = {
  slug: string;
  name: string;
  tm_city: string;
  state_code: string;
};

const CITIES: SeedCity[] = [
  { slug: "boston", name: "Boston", tm_city: "Boston", state_code: "MA" },
  { slug: "new-york", name: "New York", tm_city: "New York", state_code: "NY" },
  { slug: "brooklyn", name: "Brooklyn", tm_city: "Brooklyn", state_code: "NY" },
  { slug: "philadelphia", name: "Philadelphia", tm_city: "Philadelphia", state_code: "PA" },
  { slug: "washington", name: "Washington", tm_city: "Washington", state_code: "DC" },
  { slug: "baltimore", name: "Baltimore", tm_city: "Baltimore", state_code: "MD" },
  { slug: "pittsburgh", name: "Pittsburgh", tm_city: "Pittsburgh", state_code: "PA" },
  { slug: "buffalo", name: "Buffalo", tm_city: "Buffalo", state_code: "NY" },
  { slug: "providence", name: "Providence", tm_city: "Providence", state_code: "RI" },
  { slug: "chicago", name: "Chicago", tm_city: "Chicago", state_code: "IL" },
  { slug: "detroit", name: "Detroit", tm_city: "Detroit", state_code: "MI" },
  { slug: "milwaukee", name: "Milwaukee", tm_city: "Milwaukee", state_code: "WI" },
  { slug: "minneapolis", name: "Minneapolis", tm_city: "Minneapolis", state_code: "MN" },
  { slug: "cleveland", name: "Cleveland", tm_city: "Cleveland", state_code: "OH" },
  { slug: "columbus", name: "Columbus", tm_city: "Columbus", state_code: "OH" },
  { slug: "cincinnati", name: "Cincinnati", tm_city: "Cincinnati", state_code: "OH" },
  { slug: "indianapolis", name: "Indianapolis", tm_city: "Indianapolis", state_code: "IN" },
  { slug: "st-louis", name: "St. Louis", tm_city: "Saint Louis", state_code: "MO" },
  { slug: "kansas-city", name: "Kansas City", tm_city: "Kansas City", state_code: "MO" },
  { slug: "atlanta", name: "Atlanta", tm_city: "Atlanta", state_code: "GA" },
  { slug: "nashville", name: "Nashville", tm_city: "Nashville", state_code: "TN" },
  { slug: "charlotte", name: "Charlotte", tm_city: "Charlotte", state_code: "NC" },
  { slug: "raleigh", name: "Raleigh", tm_city: "Raleigh", state_code: "NC" },
  { slug: "richmond", name: "Richmond", tm_city: "Richmond", state_code: "VA" },
  { slug: "new-orleans", name: "New Orleans", tm_city: "New Orleans", state_code: "LA" },
  { slug: "miami", name: "Miami", tm_city: "Miami", state_code: "FL" },
  { slug: "orlando", name: "Orlando", tm_city: "Orlando", state_code: "FL" },
  { slug: "tampa", name: "Tampa", tm_city: "Tampa", state_code: "FL" },
  { slug: "austin", name: "Austin", tm_city: "Austin", state_code: "TX" },
  { slug: "dallas", name: "Dallas", tm_city: "Dallas", state_code: "TX" },
  { slug: "houston", name: "Houston", tm_city: "Houston", state_code: "TX" },
  { slug: "denver", name: "Denver", tm_city: "Denver", state_code: "CO" },
  { slug: "salt-lake-city", name: "Salt Lake City", tm_city: "Salt Lake City", state_code: "UT" },
  { slug: "phoenix", name: "Phoenix", tm_city: "Phoenix", state_code: "AZ" },
  { slug: "las-vegas", name: "Las Vegas", tm_city: "Las Vegas", state_code: "NV" },
  { slug: "los-angeles", name: "Los Angeles", tm_city: "Los Angeles", state_code: "CA" },
  { slug: "san-diego", name: "San Diego", tm_city: "San Diego", state_code: "CA" },
  { slug: "san-francisco", name: "San Francisco", tm_city: "San Francisco", state_code: "CA" },
  { slug: "oakland", name: "Oakland", tm_city: "Oakland", state_code: "CA" },
  { slug: "san-jose", name: "San Jose", tm_city: "San Jose", state_code: "CA" },
  { slug: "sacramento", name: "Sacramento", tm_city: "Sacramento", state_code: "CA" },
  { slug: "portland", name: "Portland", tm_city: "Portland", state_code: "OR" },
  { slug: "seattle", name: "Seattle", tm_city: "Seattle", state_code: "WA" },
];

/**
 * Coordinates for a city, averaged over the ZIP centroids Zippopotam returns.
 *
 * These are not decoration — they are what the search runs on. Ticketmaster ignores
 * `radius` unless it is paired with coordinates, so a city with no latitude falls
 * back to matching a venue's city *field*, which for Boston meant 21 events instead
 * of the 85 within fifty miles. Anything one town over was invisible.
 *
 * Averaging every ZIP in the city lands ~3 miles from the true centre (Boston came
 * out at 42.344,-71.008 against 42.360,-71.059). Irrelevant against a fifty-mile
 * radius, and it beats hand-typing 44 pairs of coordinates that nobody would ever
 * re-check.
 *
 * Returns null rather than throwing: a city that cannot be geocoded is still worth
 * seeding, and the search degrades to the old narrower filter for that one city.
 */
async function geocodeCity(
  city: SeedCity,
): Promise<{ latitude: number; longitude: number } | null> {
  const url = `https://api.zippopotam.us/us/${city.state_code.toLowerCase()}/${encodeURIComponent(
    city.tm_city.toLowerCase(),
  )}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      places?: { latitude?: string; longitude?: string }[];
    };
    const points = (body.places ?? [])
      .map((place) => ({
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
      );

    if (points.length === 0) return null;

    return {
      latitude:
        points.reduce((sum, p) => sum + p.latitude, 0) / points.length,
      longitude:
        points.reduce((sum, p) => sum + p.longitude, 0) / points.length,
    };
  } catch {
    return null;
  }
}

async function main() {
  const supabase = adminClientFromProcessEnv();

  const missing: string[] = [];
  const rows = [];

  // Sequential rather than in parallel: this is a one-off admin script hitting a
  // free service that asks for nothing in return, and 44 polite requests cost a few
  // seconds.
  for (const [index, city] of CITIES.entries()) {
    const point = await geocodeCity(city);
    if (!point) missing.push(`${city.name}, ${city.state_code}`);

    rows.push({
      ...city,
      country_code: "US",
      sort_order: index,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
    });
  }

  const { error } = await supabase
    .from("cities")
    .upsert(rows, { onConflict: "slug" });

  if (error) throw new Error(`Upsert failed: ${error.message}`);

  const located = rows.length - missing.length;
  console.log(`Seeded ${rows.length} cities, ${located} with coordinates.`);

  if (missing.length > 0) {
    console.warn(
      `\nNo coordinates for: ${missing.join("; ")}\n` +
        "Those will fall back to Ticketmaster's narrower city-name match, which\n" +
        "returns far fewer events. Re-run, or add the pair by hand.",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
