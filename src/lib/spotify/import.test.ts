import { test } from "node:test";
import assert from "node:assert/strict";

import { buildArtistRows } from "./import";

const USER = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-08-04T12:00:00.000Z";

function artists(...names: string[]) {
  return names.map((name, index) => ({ id: `spotify-${index}`, name }));
}

test("names that normalise to the same key collapse to one row", () => {
  // The failure this exists for: artist_prefs is unique on (user_id,
  // normalized_name), and a duplicate inside one upsert makes Postgres reject the
  // WHOLE statement. One collision would lose all fifty artists, not one.
  const rows = buildArtistRows(
    USER,
    artists("Sigur Rós", "Sigur Ros", "SIGUR ROS", "Turnstile"),
    NOW,
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.normalized_name),
    ["sigur ros", "turnstile"],
  );
  // First spelling wins, so the display name is the one Spotify ranked highest.
  assert.equal(rows[0].name, "Sigur Rós");

  const keys = new Set(rows.map((row) => row.normalized_name));
  assert.equal(keys.size, rows.length, "an upsert key repeated");
});

test("a name that normalises to nothing is dropped, not written empty", () => {
  // An empty normalized_name would match every event with an unnameable performer.
  const rows = buildArtistRows(USER, artists("!!!", "???", "Turnstile"), NOW);
  assert.ok(rows.every((row) => row.normalized_name.length > 0));
  assert.ok(rows.some((row) => row.normalized_name === "turnstile"));
});

test("Spotify's ordering survives as a descending score", () => {
  const rows = buildArtistRows(
    USER,
    artists(...Array.from({ length: 50 }, (_, i) => `Artist ${i}`)),
    NOW,
  );

  assert.equal(rows.length, 50);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i].score < rows[i - 1].score,
      `rank ${i} (${rows[i].score}) should score below rank ${i - 1} (${rows[i - 1].score})`,
    );
  }
});

test("the score band never reaches a hand-typed artist's score", () => {
  // EXPLICIT_ARTIST_SCORE in app/subscriptions/actions.ts is 1.5. Listening a lot is a
  // weaker statement than typing a name in, and a background job must not be able to
  // out-rank a deliberate choice.
  for (const count of [1, 2, 3, 17, 50]) {
    const rows = buildArtistRows(
      USER,
      artists(...Array.from({ length: count }, (_, i) => `Artist ${i}`)),
      NOW,
    );
    for (const row of rows) {
      assert.ok(row.score < 1.5, `score ${row.score} reaches the explicit score`);
      assert.ok(row.score >= 0.6, `score ${row.score} fell below the band`);
      assert.ok(Number.isFinite(row.score), `score ${row.score} is not a number`);
    }
  }
});

test("a single artist gets the top of the band, not a divide-by-zero", () => {
  // The taper divides by (length - 1). One artist is the realistic case for a new
  // account and would produce NaN without the guard — and NaN fails the insert.
  const rows = buildArtistRows(USER, artists("Turnstile"), NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].score, 1.4);
});

test("an empty list produces no rows rather than an empty upsert", () => {
  assert.deepEqual(buildArtistRows(USER, [], NOW), []);
});

test("every row is attributed to spotify and carries no Ticketmaster id", () => {
  // `source` is what lets a re-import overwrite last month's rows while leaving a
  // hand-picked artist alone. tm_attraction_id stays null because Spotify's id is not
  // Ticketmaster's and guessing a mapping would be worse than having none.
  const rows = buildArtistRows(USER, artists("Turnstile", "Wednesday"), NOW);
  for (const row of rows) {
    assert.equal(row.source, "spotify");
    assert.equal(row.tm_attraction_id, null);
    assert.equal(row.user_id, USER);
    assert.equal(row.last_seen_at, NOW);
  }
});
