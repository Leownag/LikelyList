import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizePostalCode } from "./geocode";

test("a plain five-digit ZIP passes through", () => {
  assert.equal(normalizePostalCode("02134"), "02134");
  // Leading zeros are the reason this returns a string rather than a number. New
  // England ZIPs start with 0, and Number("02134") is 2134 — a different place.
  assert.equal(normalizePostalCode("00501"), "00501");
});

test("ZIP+4 is truncated to the five that identify a place", () => {
  // The extra four digits are a delivery route within the ZIP, not a location, and
  // Zippopotam has no row for them.
  assert.equal(normalizePostalCode("02134-1234"), "02134");
});

test("surrounding whitespace is tolerated", () => {
  assert.equal(normalizePostalCode("  02134 "), "02134");
});

test("anything that is not a US ZIP is rejected rather than guessed", () => {
  for (const input of [
    "",
    "0213",
    "021345",
    "abcde",
    "02134-12",
    "02134 1234",
    "M5V 3L9",
    "02134;drop",
  ]) {
    assert.equal(
      normalizePostalCode(input),
      null,
      `expected ${JSON.stringify(input)} to be rejected`,
    );
  }
});
