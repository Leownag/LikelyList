import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DIGEST_SEND_HOURS, TIMEZONES, localParts, sendInstantFor } from "../src/lib/time";

const ROOT = join(import.meta.dirname, "..");

/**
 * The cron expressions Cloudflare is actually configured with.
 *
 * wrangler.jsonc is JSON with // comments, which nothing in the runtime parses —
 * so this strips them rather than pulling in a JSONC dependency. Line comments
 * only, which is all the file uses.
 */
function wranglerCrons(): string[] {
  const text = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  const stripped = text
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
  const config = JSON.parse(stripped) as { triggers?: { crons?: string[] } };
  return config.triggers?.crons ?? [];
}

/** The constant worker.ts compares an incoming trigger against. */
function workerWeeklyCron(): string {
  const text = readFileSync(join(ROOT, "worker.ts"), "utf8");
  const match = text.match(/const WEEKLY_CRON = "([^"]+)"/);
  assert.ok(match, "worker.ts no longer declares WEEKLY_CRON as a literal");
  return match[1];
}

test("worker.ts and wrangler.jsonc agree on the weekly cron", () => {
  // The silent catastrophe this guards. worker.ts routes a trigger by string
  // equality:
  //
  //     const mode = event.cron === WEEKLY_CRON ? "weekly" : "drain";
  //
  // so changing the schedule in wrangler.jsonc without changing the constant
  // does not fail, log, or throw. Every weekly trigger simply falls through to
  // "drain", the run is never built, and nobody is ever emailed again. Nothing
  // in the system notices, because draining an empty queue succeeds.
  const crons = wranglerCrons();
  const weekly = workerWeeklyCron();

  assert.ok(crons.length > 0, "wrangler.jsonc declares no cron triggers");
  assert.ok(
    crons.includes(weekly),
    `worker.ts expects ${JSON.stringify(weekly)}, wrangler has ${JSON.stringify(crons)}`,
  );
});

test("the weekly cron leaves room for every supported timezone", () => {
  // The builder has to fire before the earliest reader's morning, and the last
  // send has to land before the event cache it reads from expires. Both bounds
  // move whenever TIMEZONES or the cron changes, and neither failure is visible
  // until a Wednesday.
  const CACHE_TTL_HOURS = 36;

  const [minute, hour, , , weekday] = workerWeeklyCron().split(" ");
  assert.equal(weekday, "3", "the weekly cron is no longer on a Wednesday");

  // A concrete Wednesday, at the hour the cron fires.
  const runStart = new Date(
    Date.UTC(2026, 7, 5, Number(hour), Number(minute)),
  );
  assert.equal(runStart.getUTCDay(), 3);

  const earliest = DIGEST_SEND_HOURS[0];
  const latest = DIGEST_SEND_HOURS[DIGEST_SEND_HOURS.length - 1];

  for (const zone of TIMEZONES) {
    for (const sendHour of [earliest, latest]) {
      const at = sendInstantFor(runStart, zone, sendHour);
      const local = localParts(zone, at);

      assert.equal(local.weekday, 3, `${zone} @ ${sendHour} is not a Wednesday`);
      assert.equal(local.hour, sendHour, `${zone} @ ${sendHour} shifted`);
      assert.ok(
        at.getTime() >= runStart.getTime(),
        `${zone} @ ${sendHour} would have to be sent before the run is built`,
      );

      const hoursAfterBuild = (at.getTime() - runStart.getTime()) / 3_600_000;
      assert.ok(
        hoursAfterBuild < CACHE_TTL_HOURS,
        `${zone} @ ${sendHour} sends ${hoursAfterBuild}h after the build, past the ${CACHE_TTL_HOURS}h cache TTL`,
      );
    }
  }
});

test("every offered timezone is a US one", () => {
  // The listings are US-only, so a zone that can never match an event is a
  // promise the product cannot keep. London, Taipei and Tokyo were on this list.
  for (const zone of TIMEZONES) {
    assert.ok(
      zone.startsWith("America/") || zone.startsWith("Pacific/Honolulu"),
      `${zone} cannot match any listing this product carries`,
    );
  }
});
