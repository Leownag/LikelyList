import { test } from "node:test";
import assert from "node:assert/strict";

import { encodeGeohash } from "./geohash";

/**
 * Checked against the canonical published examples for the algorithm, because a
 * subtly wrong geohash does not throw — it silently searches the wrong part of the
 * planet, and the symptom would be "no events near me" rather than an error.
 */

test("encodes the reference example from the geohash definition", () => {
  // 57.64911, 10.40744 -> u4pruydqqvj (the standard worked example).
  assert.equal(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
  assert.equal(encodeGeohash(57.64911, 10.40744, 5), "u4pru");
});

test("encodes well-known city centres to their documented prefixes", () => {
  // Boston.
  assert.ok(encodeGeohash(42.3601, -71.0589, 5).startsWith("drt2"));
  // London — the classic "gcpv" prefix.
  assert.ok(encodeGeohash(51.5074, -0.1278, 5).startsWith("gcpv"));
  // Null island sits at the centre of the grid.
  assert.equal(encodeGeohash(0, 0, 4), "s000");
});

test("precision controls length, and shorter is a prefix of longer", () => {
  const long = encodeGeohash(42.3601, -71.0589, 9);
  for (const precision of [4, 5, 6, 7, 8]) {
    const short = encodeGeohash(42.3601, -71.0589, precision);
    assert.equal(short.length, precision);
    assert.ok(
      long.startsWith(short),
      `${short} should be a prefix of ${long}`,
    );
  }
});

test("nearby points share a prefix and distant ones do not", () => {
  // Boston and Cambridge are a couple of miles apart — the whole point of using a
  // radius search instead of an exact city match.
  const boston = encodeGeohash(42.3601, -71.0589, 5);
  const cambridge = encodeGeohash(42.3736, -71.1097, 5);
  assert.equal(boston.slice(0, 3), cambridge.slice(0, 3));

  const losAngeles = encodeGeohash(34.0522, -118.2437, 5);
  assert.notEqual(boston.slice(0, 2), losAngeles.slice(0, 2));
});

test("the southern and western hemispheres encode correctly", () => {
  // Sydney.
  assert.ok(encodeGeohash(-33.8688, 151.2093, 5).startsWith("r3g"));
  // Buenos Aires.
  assert.ok(encodeGeohash(-34.6037, -58.3816, 4).length === 4);
});

test("out-of-range and non-finite coordinates are rejected loudly", () => {
  assert.throws(() => encodeGeohash(91, 0), /Latitude/);
  assert.throws(() => encodeGeohash(-91, 0), /Latitude/);
  assert.throws(() => encodeGeohash(0, 181), /Longitude/);
  assert.throws(() => encodeGeohash(0, -181), /Longitude/);
  assert.throws(() => encodeGeohash(Number.NaN, 0), /finite/);
  assert.throws(() => encodeGeohash(0, Number.POSITIVE_INFINITY), /finite/);
});
