/**
 * Guessing which of our cities a visitor is near.
 *
 * Done from the browser's IANA timezone rather than an IP geolocation service: it
 * needs no third party, no consent prompt, and no network call, and it is right at
 * the metro level often enough to be a useful default. It is explicitly a guess —
 * the landing page shows what it picked and lets the visitor change it, because
 * `America/New_York` covers everywhere from Maine to Florida.
 *
 * Deliberately not a geolocation permission request: asking for precise location
 * to pre-fill a dropdown is a bad trade.
 */

/** IANA zone -> the slug of the city in our seeded list that best matches. */
const ZONE_TO_CITY_SLUG: Record<string, string> = {
  "America/New_York": "new-york",
  "America/Detroit": "detroit",
  "America/Toronto": "new-york",
  "America/Chicago": "chicago",
  "America/Indiana/Indianapolis": "indianapolis",
  "America/Kentucky/Louisville": "cincinnati",
  "America/Denver": "denver",
  "America/Boise": "salt-lake-city",
  "America/Phoenix": "phoenix",
  "America/Los_Angeles": "los-angeles",
  "America/Anchorage": "seattle",
  "Pacific/Honolulu": "los-angeles",
};

/**
 * A rough fallback by UTC offset, for a zone we have not listed — there are far
 * more IANA zones than it is sensible to enumerate, and being in the right
 * timezone band is better than defaulting everyone to New York.
 */
const OFFSET_TO_CITY_SLUG: [number, string][] = [
  [-5, "new-york"],
  [-4, "new-york"],
  [-6, "chicago"],
  [-7, "denver"],
  [-8, "los-angeles"],
  [-9, "seattle"],
  [-10, "los-angeles"],
];

export const DEFAULT_CITY_SLUG = "new-york";

/** Runs in the browser. Returns a city slug from our seeded list. */
export function guessCitySlug(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const direct = ZONE_TO_CITY_SLUG[zone];
    if (direct) return direct;

    // Offset in hours, negated because getTimezoneOffset is minutes *behind* UTC.
    const offsetHours = -new Date().getTimezoneOffset() / 60;
    const nearest = OFFSET_TO_CITY_SLUG.find(([offset]) => offset === offsetHours);
    if (nearest) return nearest[1];
  } catch {
    // Intl unavailable or blocked; fall through.
  }
  return DEFAULT_CITY_SLUG;
}

/** The browser's timezone, validated against the zones we accept. */
export function guessTimezone(supported: readonly string[]): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (supported.includes(zone)) return zone;
  } catch {
    // Fall through.
  }
  return "America/New_York";
}
