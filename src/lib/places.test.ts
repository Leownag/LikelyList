import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cleanPlaceName,
  distanceMiles,
  placeBand,
  placeLabel,
  placeRank,
  placeSearchKey,
} from "./places";

test("Census type suffixes are stripped from place names", () => {
  // The Gazetteer spells these out; a search box does not want them.
  assert.equal(cleanPlaceName("Boston city"), "Boston");
  assert.equal(cleanPlaceName("Abanda CDP"), "Abanda");
  assert.equal(cleanPlaceName("Brookline town"), "Brookline");
  assert.equal(cleanPlaceName("Lawrenceville village"), "Lawrenceville");
  assert.equal(cleanPlaceName("Nashville-Davidson metropolitan government"), "Nashville-Davidson");
});

test("stacked Census suffixes are both removed", () => {
  // The gap that let a bug through: the Gazetteer stacks a type suffix and
  // "(balance)", and stripping only the outer one stored Indianapolis as
  // "Indianapolis city" — which then failed to match the curated-metro list.
  assert.equal(cleanPlaceName("Indianapolis city (balance)"), "Indianapolis");
  assert.equal(
    cleanPlaceName("Nashville-Davidson metropolitan government (balance)"),
    "Nashville-Davidson",
  );
  assert.equal(cleanPlaceName("Athens-Clarke County unified government (balance)"), "Athens-Clarke County unified government");
});

test("a doubled designator is reduced to the bare name", () => {
  // Massachusetts spells these "Amherst Town city". One pass left "Amherst Town" in
  // the suggestions, which is Census bookkeeping rather than what the place is called.
  assert.equal(cleanPlaceName("Amherst Town city"), "Amherst");
  assert.equal(cleanPlaceName("Barnstable Town city"), "Barnstable");
});

test("a suffix inside the name is left alone", () => {
  // "City" is part of the name in these, not a Census descriptor, and stripping it
  // would rename the place.
  assert.equal(cleanPlaceName("Kansas City city"), "Kansas City");
  assert.equal(cleanPlaceName("Salt Lake City city"), "Salt Lake City");
  assert.equal(cleanPlaceName("Village of Clarkston city"), "Village of Clarkston");
});

test("the curated metros outrank everything else", () => {
  const boston = placeRank(placeSearchKey("Boston", "MA"), "25", 48);
  const otherBoston = placeRank(placeSearchKey("Boston", "GA"), "25", 5);
  assert.equal(boston, 0);
  assert.ok(
    otherBoston > boston,
    `expected Boston, GA (${otherBoston}) to rank after Boston, MA (${boston})`,
  );
});

test("Portland, OR beats Portland, TX — the case this ranking exists for", () => {
  const oregon = placeRank(placeSearchKey("Portland", "OR"), "25", 133);
  const texas = placeRank(placeSearchKey("Portland", "TX"), "25", 6);
  assert.ok(
    oregon < texas,
    `expected Portland, OR (${oregon}) before Portland, TX (${texas})`,
  );
});

test("an incorporated city outranks a Census-designated place", () => {
  // A CDP is a statistical boundary rather than a government, so when a name matches
  // both, the city is the better guess.
  const city = placeRank(placeSearchKey("Springfield", "IL"), "25", 60);
  const cdp = placeRank(placeSearchKey("Springfield", "NY"), "57", 60);
  assert.ok(city < cdp, `expected city (${city}) before CDP (${cdp})`);
});

test("land area only breaks ties inside a band, never across one", () => {
  // A sprawling CDP must not overtake a small incorporated town, or the ordering
  // would be driven by acreage instead of by what the place actually is.
  const smallTown = placeRank(placeSearchKey("Tiny", "VT"), "43", 1);
  const hugeCdp = placeRank(placeSearchKey("Sprawl", "NV"), "57", 5000);
  assert.ok(
    smallTown < hugeCdp,
    `expected small town (${smallTown}) before huge CDP (${hugeCdp})`,
  );
});

test("a missing or absurd area does not produce a broken rank", () => {
  for (const area of [0, -1, Number.NaN, 1e9]) {
    const rank = placeRank(placeSearchKey("Somewhere", "KS"), "25", area);
    assert.ok(
      Number.isFinite(rank) && rank > 0,
      `area ${area} produced rank ${rank}`,
    );
  }
});

test("a name that already carries its state does not get a second one", () => {
  // The seeded Washington row was `name: "Washington, DC"` with `state_code: "DC"`,
  // which two different renderers turned into two different wrong answers. The seed
  // is fixed, but rows written before that are still in the database.
  assert.equal(placeLabel("Washington, DC", "DC"), "Washington, DC");
  assert.equal(placeLabel("washington, dc", "DC"), "washington, dc");
  assert.equal(placeLabel("Washington", "DC"), "Washington, DC");
});

test("placeLabel copes with the halves it can be handed", () => {
  assert.equal(placeLabel("Cambridge", "MA"), "Cambridge, MA");
  assert.equal(placeLabel("Cambridge", null), "Cambridge");
  assert.equal(placeLabel(null, "MA"), "MA");
  assert.equal(placeLabel(null, null), "");
  // "Camden" must not be swallowed by a state code it merely ends with.
  assert.equal(placeLabel("Camden", "DEN"), "Camden, DEN");
});

test("the rank band ignores the land-area tiebreak inside it", () => {
  // The bug this exists for: rank carries "what kind of place" in its hundreds
  // and "how physically large" in its units, and the second was deciding
  // matches. Cambridge, MA (~6 sq mi) and Camarillo, CA (~20 sq mi) are both
  // incorporated cities, so they must land in the same band and let something
  // else — distance — choose between them.
  const cambridge = placeRank(placeSearchKey("Cambridge", "MA"), "25", 6.4);
  const camarillo = placeRank(placeSearchKey("Camarillo", "CA"), "25", 19.6);
  assert.ok(camarillo < cambridge, "precondition: area still ranks Camarillo first");
  assert.equal(placeBand(cambridge), placeBand(camarillo));

  // A curated metro keeps a band to itself, so "new" still offers New York
  // before a nearer Newton.
  assert.equal(placeBand(placeRank(placeSearchKey("New York", "NY"), "25", 300)), 0);
  assert.ok(placeBand(cambridge) > 0);

  // And the kinds stay ordered: city before town before CDP.
  const town = placeRank(placeSearchKey("Brookline", "MA"), "43", 6.8);
  const cdp = placeRank(placeSearchKey("Somewhere", "MA"), "57", 6.8);
  assert.ok(placeBand(cambridge) < placeBand(town));
  assert.ok(placeBand(town) < placeBand(cdp));
});

test("distanceMiles is close enough to order a dropdown", () => {
  const boston = { latitude: 42.3601, longitude: -71.0589 };
  const cambridge = { latitude: 42.3736, longitude: -71.1097 };
  const camarillo = { latitude: 34.2164, longitude: -119.0376 };

  assert.ok(distanceMiles(boston, cambridge) < 5);
  assert.ok(distanceMiles(boston, camarillo) > 2500);
  assert.equal(Math.round(distanceMiles(boston, boston)), 0);
  // Symmetric, because a sort that is not would be unstable.
  assert.equal(
    Math.round(distanceMiles(boston, camarillo)),
    Math.round(distanceMiles(camarillo, boston)),
  );
});
