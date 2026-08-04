import assert from "node:assert/strict";
import test from "node:test";
import { summariseGenres } from "./anonymous-subscribe";

const genres = [
  { id: 1, name: "Rock" },
  { id: 2, name: "Pop" },
  { id: 3, name: "Metal" },
  { id: 4, name: "Folk" },
  { id: 5, name: "Jazz" },
];

test("the preset line names the genres the search actually used", () => {
  assert.equal(summariseGenres(genres, [1, 2]), "Rock, Pop");
  assert.equal(summariseGenres(genres, [1, 2, 3, 4]), "Rock, Pop, Metal and 1 more");

  // /explore sends every genre id when the reader filtered by none, because that is
  // what they were shown — and the digest skips a subscriber who follows nothing.
  assert.equal(summariseGenres(genres, [1, 2, 3, 4, 5]), "every genre");
  assert.equal(summariseGenres(genres, []), "every genre");
});
