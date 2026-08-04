import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPLICIT_ARTIST_SCORE,
  FEED_ARTIST_SCORE_CAP,
  SPOTIFY_TOP_SCORE,
  accumulateFeedScore,
  spotifyRankScore,
} from "./artist-score";

test("a repeatedly-seen artist converges instead of running away", () => {
  // The bug: apply.ts added a weight per sighting with no bound, so uploading the same
  // library screenshot ten times pushed one artist to 10. buildDigest caps the TOTAL
  // artist contribution at 3, so that one artist then satisfied the cap alone and pushed
  // everything else out of the week — which nobody reports as a bug, they just notice
  // the digest got worse.
  let score = 0;
  for (let i = 0; i < 20; i++) score = accumulateFeedScore(score, "primary");

  assert.equal(score, FEED_ARTIST_SCORE_CAP);
  assert.ok(score <= EXPLICIT_ARTIST_SCORE);
});

test("more sightings still mean more, up to the cap", () => {
  // The accumulation itself is right: seeing a name in five screenshots really is
  // stronger evidence than seeing it once. Only the unbounded growth was wrong.
  const once = accumulateFeedScore(0, "primary");
  const twice = accumulateFeedScore(once, "primary");
  assert.ok(twice > once);
});

test("prominence still ranks, and an unknown one lands between", () => {
  const primary = accumulateFeedScore(0, "primary");
  const unknown = accumulateFeedScore(0, null);
  const mentioned = accumulateFeedScore(0, "mentioned");

  assert.ok(primary > unknown);
  assert.ok(unknown > mentioned);
});

test("a corrupt existing score cannot poison the next one", () => {
  // NaN or a negative would reach an integer-free numeric column and then the scorer.
  for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
    const next = accumulateFeedScore(bad, "primary");
    assert.ok(
      Number.isFinite(next) && next > 0 && next <= FEED_ARTIST_SCORE_CAP,
      `${bad} produced ${next}`,
    );
  }
});

test("inference never outranks a reader saying it themselves", () => {
  // The whole point of the scale. A screenshot and a listening history are both guesses;
  // typing a name in is not.
  assert.ok(FEED_ARTIST_SCORE_CAP <= EXPLICIT_ARTIST_SCORE);
  assert.ok(SPOTIFY_TOP_SCORE < EXPLICIT_ARTIST_SCORE);
  for (const total of [1, 2, 50]) {
    for (let i = 0; i < total; i++) {
      assert.ok(
        spotifyRankScore(i, total) < EXPLICIT_ARTIST_SCORE,
        `rank ${i}/${total} reached the explicit score`,
      );
    }
  }
});

test("a single Spotify artist gets the top of the band, not NaN", () => {
  // The taper divides by (total - 1). One artist is realistic for a new account.
  assert.equal(spotifyRankScore(0, 1), SPOTIFY_TOP_SCORE);
  assert.ok(Number.isFinite(spotifyRankScore(0, 1)));
});
