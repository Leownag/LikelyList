/**
 * Geohash encoding, for Ticketmaster's `geoPoint` parameter.
 *
 * Needed because the probe established two things empirically:
 *   - `city=Boston` returns only venues in Boston proper, so Cambridge,
 *     Somerville and Allston shows are invisible
 *   - `radius` is silently ignored alongside both `city` and `postalCode`
 *
 * Radius only takes effect with coordinates, and Ticketmaster's coordinate
 * parameter is `geoPoint`, which takes a geohash (`latlong` exists but the docs
 * mark it deprecated). Hence this: about thirty lines instead of a dependency.
 *
 * Precision matters less than it looks. A geohash is a bounding box, and the
 * search is `within radius of this box`, so 5–7 characters is plenty for a metro
 * centre — Ticketmaster's own examples use short hashes. Over-precise hashes just
 * make the URL longer.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Encodes a latitude/longitude pair.
 *
 * @param precision Characters of output. 5 ≈ 5km cell, 6 ≈ 1.2km, 7 ≈ 150m.
 */
export function encodeGeohash(
  latitude: number,
  longitude: number,
  precision = 6,
): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("encodeGeohash needs finite coordinates.");
  }
  if (latitude < -90 || latitude > 90) {
    throw new Error(`Latitude out of range: ${latitude}`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error(`Longitude out of range: ${longitude}`);
  }

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = "";
  let bits = 0;
  let bitCount = 0;
  // Longitude and latitude bits alternate, starting with longitude.
  let useLongitude = true;

  while (hash.length < precision) {
    if (useLongitude) {
      const mid = (lonMin + lonMax) / 2;
      if (longitude >= mid) {
        bits = (bits << 1) | 1;
        lonMin = mid;
      } else {
        bits = bits << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        bits = (bits << 1) | 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }

    useLongitude = !useLongitude;
    bitCount += 1;

    // Five bits per base-32 character.
    if (bitCount === 5) {
      hash += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }

  return hash;
}
