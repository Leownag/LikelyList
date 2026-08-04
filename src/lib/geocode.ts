import type { AdminClient } from "@/lib/supabase/admin";

/**
 * ZIP code → coordinates, cache first.
 *
 * Exists because Ticketmaster's `postalCode` filter is close to useless on its own:
 * it matches the one ZIP exactly and accepts `radius` without applying it, so a
 * search around Boston's 02134 returned two events where coordinates plus a 50-mile
 * radius returned eighty-five. Coordinates are the only way to ask "near here", so
 * a ZIP has to become a point first.
 *
 * Why Zippopotam: it needs no key, no account and no attribution, answers over
 * HTTPS, and returns exactly the four fields wanted. The obvious official
 * alternative, the US Census geocoder, returns no match for a bare ZIP — measured,
 * not assumed. The risk of leaning on a small free service is contained by caching:
 * a ZIP centroid never moves, so each code costs one request ever, and this is only
 * reached from /explore. The digest pipeline never geocodes, because it works from
 * the `cities` table, which is seeded with coordinates already.
 */

const ZIPPOPOTAM = "https://api.zippopotam.us/us";

/** Third-party call on a request path, so it gets a short leash. */
const TIMEOUT_MS = 4000;

export type GeoPoint = {
  latitude: number;
  longitude: number;
  /** "Allston", so the UI can echo back where it thinks the reader means. */
  placeName: string | null;
  stateCode: string | null;
};

type ZippopotamResponse = {
  places?: {
    latitude?: string;
    longitude?: string;
    "place name"?: string;
    "state abbreviation"?: string;
  }[];
};

/** Five digits. A ZIP+4 is accepted and truncated, since the extra four are a
 *  delivery route rather than a place. */
export function normalizePostalCode(input: string): string | null {
  const match = input.trim().match(/^(\d{5})(-\d{4})?$/);
  return match ? match[1] : null;
}

/**
 * Coordinates for a US ZIP, or null.
 *
 * Null is a normal outcome — a made-up ZIP, or the service being down — and the
 * caller is expected to say "we could not place that ZIP, pick a city instead"
 * rather than to fail. A failed lookup is deliberately not cached: caching it would
 * turn one bad minute at a third party into a permanently broken ZIP.
 */
export async function geocodePostalCode(
  supabase: AdminClient,
  rawCode: string,
): Promise<GeoPoint | null> {
  const code = normalizePostalCode(rawCode);
  if (!code) return null;

  const { data: cached } = await supabase
    .from("postal_codes")
    .select("latitude, longitude, place_name, state_code")
    .eq("code", code)
    .maybeSingle<{
      latitude: number;
      longitude: number;
      place_name: string | null;
      state_code: string | null;
    }>();

  if (cached) {
    return {
      latitude: Number(cached.latitude),
      longitude: Number(cached.longitude),
      placeName: cached.place_name,
      stateCode: cached.state_code,
    };
  }

  const fetched = await fetchFromZippopotam(code);
  if (!fetched) return null;

  // Not awaited for correctness — the caller has what it needs, and a failed cache
  // write should cost the next visitor one lookup rather than this visitor a search.
  await supabase.from("postal_codes").upsert(
    {
      code,
      latitude: fetched.latitude,
      longitude: fetched.longitude,
      place_name: fetched.placeName,
      state_code: fetched.stateCode,
    },
    { onConflict: "code" },
  );

  return fetched;
}

async function fetchFromZippopotam(code: string): Promise<GeoPoint | null> {
  try {
    const response = await fetch(`${ZIPPOPOTAM}/${code}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    // A ZIP that does not exist is a 404 here, which is information rather than a
    // fault, so it is not logged as one.
    if (!response.ok) return null;

    const body = (await response.json()) as ZippopotamResponse;
    const place = body.places?.[0];
    if (!place) return null;

    const latitude = Number(place.latitude);
    const longitude = Number(place.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    // Sanity-bound the values before they reach a geohash encoder that throws on
    // out-of-range input.
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

    return {
      latitude,
      longitude,
      placeName: place["place name"] ?? null,
      stateCode: place["state abbreviation"] ?? null,
    };
  } catch {
    // Timeout, DNS, malformed JSON — all the same to the caller.
    return null;
  }
}
