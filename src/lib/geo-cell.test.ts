import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GEO_CELL_DEGREES,
  geoCellCentre,
  geoCellKey,
  parseGeoCellKey,
} from "./geo-cell";

test("nearby points share a cell, so they share one API call", () => {
  // The whole point of the grid. Boston and Cambridge are four miles apart; paying
  // Ticketmaster twice for two overlapping 50-mile searches is the cost this avoids.
  const boston = geoCellKey(42.3601, -71.0589);
  const cambridge = geoCellKey(42.3736, -71.1097);
  assert.equal(boston, cambridge);
});

test("genuinely different metros do not share a cell", () => {
  // The failure in the other direction: if the grid were coarse enough to merge these,
  // a Boston subscriber would be served a search centred somewhere in Connecticut.
  const boston = geoCellKey(42.3601, -71.0589);
  const providence = geoCellKey(41.824, -71.4128);
  const newYork = geoCellKey(40.7128, -74.006);

  assert.notEqual(boston, providence);
  assert.notEqual(boston, newYork);
  assert.notEqual(providence, newYork);
});

test("a key round-trips to the centre it names", () => {
  // The planner reads the key back to get a query centre, so this is load-bearing
  // rather than a convenience.
  const key = geoCellKey(42.3601, -71.0589);
  const centre = parseGeoCellKey(key);
  assert.deepEqual(centre, geoCellCentre(42.3601, -71.0589));
  assert.equal(geoCellKey(centre!.latitude, centre!.longitude), key);
});

test("no point is further from its centre than half a cell", () => {
  // This bounds the error the grid introduces. Anything larger means a subscriber's
  // search is centred somewhere they would not recognise.
  const half = GEO_CELL_DEGREES / 2;
  for (const [lat, lon] of [
    [42.3601, -71.0589],
    [40.7128, -74.006],
    [34.0522, -118.2437],
    [61.2181, -149.9003],
    [21.3069, -157.8583],
    [0, 0],
    [-33.8688, 151.2093],
  ]) {
    const centre = geoCellCentre(lat, lon);
    assert.ok(
      Math.abs(centre.latitude - lat) <= half + 1e-9,
      `lat ${lat} → ${centre.latitude}`,
    );
    assert.ok(
      Math.abs(centre.longitude - lon) <= half + 1e-9,
      `lon ${lon} → ${centre.longitude}`,
    );
  }
});

test("one cell has exactly one key", () => {
  // Two spellings of the same cell would become two cache rows and two API calls,
  // silently undoing the sharing this exists for.
  assert.equal(geoCellKey(42.25, -71.0), geoCellKey(42.2501, -70.9999));
  assert.equal(geoCellKey(42.25, -71), "42.25,-71");
  // Not "42.25,-71.00" or "42.250,-71".
  assert.ok(!geoCellKey(42.25, -71).includes(".00"));
});

test("the prime meridian and equator do not produce a negative zero key", () => {
  // "-0" and "0" are different strings and would key two rows to the same cell.
  assert.equal(geoCellKey(0.01, -0.01), "0,0");
  assert.ok(!geoCellKey(-0.01, -0.01).includes("-0,"));
});

test("a malformed key is rejected rather than becoming NaN coordinates", () => {
  // NaN coordinates would reach the geohash encoder, which throws, and take down a
  // whole weekly run for one bad row.
  for (const key of ["", "abc", "42.25", "42.25,", ",-71", "999,-71", "42,-999"]) {
    assert.equal(parseGeoCellKey(key), null, `expected ${JSON.stringify(key)} rejected`);
  }
});
