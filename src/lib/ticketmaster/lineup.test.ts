import { test } from "node:test";
import assert from "node:assert/strict";

import { pickImage, resolveLineup, externalLink } from "./lineup";
import type { TmAttraction, TmEvent } from "./types";
import { normalizeName, containsTokenSequence, titleFragments } from "@/lib/normalize";

/**
 * Headliner inference is the riskiest pure logic in the project: Ticketmaster
 * exposes no billing order, so getting this wrong means confidently mislabelling
 * a support act as the headliner in someone's inbox. These cases cover the
 * title shapes the API actually returns, plus the case where we must refuse to
 * guess.
 */

function attraction(name: string, extra: Partial<TmAttraction> = {}): TmAttraction {
  return { id: `id-${normalizeName(name).replace(/ /g, "-")}`, name, ...extra };
}

function event(name: string, attractions: TmAttraction[]): TmEvent {
  return { id: "evt", name, _embedded: { attractions } };
}

test("normalizeName collapses accents, case, punctuation and ampersands", () => {
  assert.equal(normalizeName("Sigur Rós"), "sigur ros");
  assert.equal(normalizeName("SIGUR ROS"), "sigur ros");
  assert.equal(normalizeName("Florence + the Machine"), "florence the machine");
  assert.equal(normalizeName("Simon & Garfunkel"), "simon and garfunkel");
  assert.equal(normalizeName("Guns N' Roses"), "guns n roses");
  assert.equal(normalizeName("  Wednesday   "), "wednesday");
});

test("containsTokenSequence respects word boundaries", () => {
  assert.ok(containsTokenSequence("Turnstile Never Enough Tour", "Turnstile"));
  assert.ok(containsTokenSequence("An Evening With Big Thief", "Big Thief"));
  // "Bad" must not match inside "Bad Bunny" as a standalone token sequence...
  assert.ok(containsTokenSequence("Bad Bunny Live", "Bad"));
  // ...but a partial word must not match at all.
  assert.equal(containsTokenSequence("Madonna Live", "Mado"), false);
  assert.equal(containsTokenSequence("Short", "Longer Than Haystack"), false);
});

test("titleFragments extracts the artist prefix from common title shapes", () => {
  assert.ok(titleFragments("Radiohead: In Rainbows Tour").includes("Radiohead"));
  assert.ok(titleFragments("Turnstile - Never Enough Tour").includes("Turnstile"));
  assert.ok(titleFragments("Big Thief | Double Infinity").includes("Big Thief"));
  assert.ok(titleFragments("Wednesday w/ Hotline TNT").includes("Wednesday"));
});

test("a single performer is always the headliner", () => {
  const lineup = resolveLineup(event("Some Festival 2026", [attraction("Caroline Polachek")]));
  assert.equal(lineup.length, 1);
  assert.equal(lineup[0].isHeadliner, true);
});

test("headliner is matched from the title prefix, not array order", () => {
  // Support act deliberately placed first: array order is not documented or
  // guaranteed, so trusting index 0 would get this backwards.
  const lineup = resolveLineup(
    event("Turnstile: Never Enough Tour", [
      attraction("Blood Orange"),
      attraction("Turnstile"),
    ]),
  );
  const headliners = lineup.filter((p) => p.isHeadliner).map((p) => p.attraction.name);
  assert.deepEqual(headliners, ["Turnstile"]);
});

test("headliner matching uses aliases", () => {
  const lineup = resolveLineup(
    event("Sigur Ros: Route One", [
      attraction("Opening Band"),
      attraction("Sigur Rós", { aliases: ["Sigur Ros"] }),
    ]),
  );
  assert.deepEqual(
    lineup.filter((p) => p.isHeadliner).map((p) => p.attraction.name),
    ["Sigur Rós"],
  );
});

test("an exact fragment match beats a substring match on the whole title", () => {
  const lineup = resolveLineup(
    event("Wednesday - Bleeds Tour with Hotline TNT", [
      attraction("Hotline TNT"),
      attraction("Wednesday"),
    ]),
  );
  assert.deepEqual(
    lineup.filter((p) => p.isHeadliner).map((p) => p.attraction.name),
    ["Wednesday"],
  );
});

test("no headliner is claimed when the title names none of the performers", () => {
  // A festival bill. Guessing here would put a false "headliner" label in an
  // email, so the correct behaviour is to label everyone same-bill.
  const lineup = resolveLineup(
    event("Boston Calling Music Festival", [
      attraction("Fontaines D.C."),
      attraction("Japanese Breakfast"),
      attraction("Militarie Gun"),
    ]),
  );
  assert.equal(lineup.length, 3);
  assert.equal(lineup.filter((p) => p.isHeadliner).length, 0);
});

test("test attractions are dropped", () => {
  const lineup = resolveLineup(
    event("Real Artist Live", [
      attraction("Real Artist"),
      attraction("Fake Placeholder", { test: true }),
    ]),
  );
  assert.equal(lineup.length, 1);
  assert.equal(lineup[0].attraction.name, "Real Artist");
});

test("pickImage prefers real artwork over fallback placeholders", () => {
  const url = pickImage([
    { url: "http://s1.ticketm.net/generic.jpg", width: 305, height: 203, fallback: true },
    { url: "http://s1.ticketm.net/real.jpg", width: 305, height: 203, fallback: false },
  ]);
  assert.equal(url, "https://s1.ticketm.net/real.jpg");
});

test("pickImage upgrades http to https and respects the width budget", () => {
  const url = pickImage(
    [
      { url: "http://s1.ticketm.net/small.jpg", width: 205, height: 115, ratio: "16_9" },
      { url: "http://s1.ticketm.net/huge.jpg", width: 2048, height: 1152, ratio: "16_9" },
    ],
    { maxWidth: 320, ratio: "16_9" },
  );
  assert.equal(url, "https://s1.ticketm.net/small.jpg");
});

test("pickImage falls back to the smallest image when none fit the budget", () => {
  const url = pickImage(
    [{ url: "https://s1.ticketm.net/only.jpg", width: 2048, height: 1152 }],
    { maxWidth: 320 },
  );
  assert.equal(url, "https://s1.ticketm.net/only.jpg");
});

test("externalLink tolerates the field being absent or malformed", () => {
  assert.equal(externalLink(attraction("A"), ["youtube"]), null);
  assert.equal(
    externalLink(attraction("B", { externalLinks: {} }), ["youtube"]),
    null,
  );
  assert.equal(
    externalLink(
      // Ticketmaster never documents the provider keys, so entries can be
      // present but empty.
      attraction("C", { externalLinks: { youtube: [{ id: "x" }] } }),
      ["youtube"],
    ),
    null,
  );
  assert.equal(
    externalLink(
      attraction("D", {
        externalLinks: { youtube: [{ url: "http://youtube.com/@band" }] },
      }),
      ["youtube"],
    ),
    "https://youtube.com/@band",
  );
});
