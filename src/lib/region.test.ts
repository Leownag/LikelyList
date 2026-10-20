import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CITY_SLUG,
  REACHABLE_CITY_SLUGS,
  pointForCitySlug,
} from "./region";

test("every slug the timezone guess can produce has coordinates", () => {
  // Quiet failure this guards: adding a zone mapping without a point breaks
  // nothing visibly — the search box just silently stops ordering by distance
  // for everyone in that zone.
  for (const slug of REACHABLE_CITY_SLUGS) {
    const point = pointForCitySlug(slug);
    assert.ok(point, `${slug} has no coordinates`);
    assert.ok(Number.isFinite(point.latitude), `${slug} latitude`);
    assert.ok(Number.isFinite(point.longitude), `${slug} longitude`);
    // All of these are US metros, so a sign flip would be caught here.
    assert.ok(point.latitude > 18 && point.latitude < 72, `${slug} latitude range`);
    assert.ok(point.longitude < -66 && point.longitude > -180, `${slug} longitude range`);
  }
});

test("the default slug is one of the reachable ones", () => {
  assert.ok(REACHABLE_CITY_SLUGS.includes(DEFAULT_CITY_SLUG));
});

test("an unknown slug yields no point rather than throwing", () => {
  assert.equal(pointForCitySlug("atlantis"), null);
});
