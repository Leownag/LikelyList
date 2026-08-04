import { test } from "node:test";
import assert from "node:assert/strict";

import { byGenrePopularity, genreRank } from "./genre-ranking";

function order(names: string[]): string[] {
  return names.map((name) => ({ name })).sort(byGenrePopularity).map((g) => g.name);
}

test("the mainstream genres come first, not the alphabetical ones", () => {
  // The reason this module exists: alphabetically, Alternative/Blues/Classical
  // push Rock, Pop and Hip-Hop below the fold in the picker.
  assert.deepEqual(
    order(["Classical", "Blues", "Alternative", "Rock", "Pop", "Hip-Hop/Rap"]),
    ["Rock", "Pop", "Hip-Hop/Rap", "Alternative", "Blues", "Classical"],
  );
});

test("Ticketmaster's actual compound names resolve", () => {
  for (const name of ["Hip-Hop/Rap", "Dance/Electronic", "R&B"]) {
    assert.ok(
      Number.isFinite(genreRank(name)),
      `${name} should be ranked, got ${genreRank(name)}`,
    );
  }
});

test("synonyms rank with their canonical genre", () => {
  assert.equal(genreRank("Hip Hop"), genreRank("Hip-Hop/Rap"));
  assert.equal(genreRank("Rap"), genreRank("Hip-Hop/Rap"));
  assert.equal(genreRank("EDM"), genreRank("Dance/Electronic"));
  assert.equal(genreRank("RnB"), genreRank("R&B"));
  assert.equal(genreRank("Hard Rock/Metal"), genreRank("Metal"));
});

test("unranked genres sort alphabetically after every ranked one", () => {
  const result = order(["Zydeco", "Rock", "Bluegrass", "Pop"]);
  assert.deepEqual(result, ["Rock", "Pop", "Bluegrass", "Zydeco"]);
  assert.equal(genreRank("Zydeco"), Number.POSITIVE_INFINITY);
});

test("the sort is total and stable across repeated runs", () => {
  // Re-seeding an unchanged taxonomy must produce identical sort_order values
  // rather than reshuffling the picker under the user.
  const input = ["Folk", "Rock", "Zydeco", "Pop", "Bluegrass", "Metal"];
  const first = order(input);
  const second = order([...input].reverse());
  assert.deepEqual(first, second);
});

test("case and punctuation do not affect ranking", () => {
  assert.equal(genreRank("rock"), genreRank("Rock"));
  assert.equal(genreRank("HIP-HOP/RAP"), genreRank("Hip-Hop/Rap"));
});
