/**
 * Post-deploy smoke test: does the live site serve what we think we shipped?
 *
 *   npm run smoke                      against https://likelylist.tech
 *   npm run smoke http://localhost:3000
 *
 * Read-only, no login, no writes, a few seconds. It runs straight after
 * `npm run deploy` so a deploy cannot report success while shipping nothing —
 * which is exactly what happened once: a release tagged from a branch that had
 * never been merged deployed cleanly, and the previous build stayed live for an
 * hour until somebody asked whether a fix was in.
 *
 * Deliberately NOT a second copy of the Playwright walk. That drives a browser
 * and signs in; this answers the narrower question a deploy raises — right
 * commit, pages up, contracts intact, nothing obviously unauthenticated — and
 * it answers it fast enough to run every time.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DIGEST_SEND_HOURS, DIGEST_WEEKDAY, TIMEZONES } from "../src/lib/time";

const BASE = (process.argv[2] ?? "https://likelylist.tech").replace(/\/$/, "");

/** Compared against what the deployment reports. Skipped outside a git tree. */
function localHead(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const localVersion = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

type Outcome = "pass" | "fail" | "skip";
const results: { name: string; outcome: Outcome; detail: string }[] = [];

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? "";
    const skipped = detail.startsWith("skip:");
    results.push({
      name,
      outcome: skipped ? "skip" : "pass",
      detail: skipped ? detail.slice(5).trim() : detail,
    });
    console.log(`${skipped ? "○" : "✓"} ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    results.push({ name, outcome: "fail", detail });
    console.log(`✗ ${name}\n    ${detail.split("\n")[0]}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function get(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    // Cloudflare caches aggressively and a stale answer would make this lie.
    headers: { "cache-control": "no-cache", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(45_000),
  });
  return response;
}

async function text(path: string) {
  const response = await get(path);
  return { status: response.status, body: await response.text(), response };
}

async function main() {
  console.log(`smoke → ${BASE}\n`);

  // ---- what is actually running -------------------------------------------

  let health: {
    sha?: string;
    version?: string;
    digest?: { weekday?: number; sendHours?: number[]; timezones?: number };
  } = {};

  await check("/api/health answers", async () => {
    const response = await get("/api/health");
    assert(response.ok, `HTTP ${response.status}`);
    health = await response.json();
    return `sha ${(health.sha ?? "?").slice(0, 8)} · v${health.version}`;
  });

  await check("the deployed commit is the local one", async () => {
    const head = localHead();
    if (!head) return "skip: not a git checkout";
    if (health.sha === "unknown") {
      return "skip: built without BUILD_SHA (use npm run deploy)";
    }
    assert(
      health.sha === head,
      `deployed ${health.sha?.slice(0, 8)}, local HEAD ${head.slice(0, 8)} — the deploy did not ship this commit`,
    );
    return head.slice(0, 8);
  });

  await check("the deployed version is the local one", async () => {
    assert(
      health.version === localVersion,
      `deployed ${health.version}, local ${localVersion}`,
    );
    return `v${localVersion}`;
  });

  await check("the schedule constants match the code", async () => {
    // Catches a deploy that predates a scheduling change, which is otherwise
    // invisible until the wrong morning.
    assert(
      health.digest?.weekday === DIGEST_WEEKDAY,
      `deployed weekday ${health.digest?.weekday}, code ${DIGEST_WEEKDAY}`,
    );
    assert(
      health.digest?.sendHours?.join() === DIGEST_SEND_HOURS.join(),
      `deployed hours ${health.digest?.sendHours?.join()}, code ${DIGEST_SEND_HOURS.join()}`,
    );
    assert(
      health.digest?.timezones === TIMEZONES.length,
      `deployed ${health.digest?.timezones} timezones, code ${TIMEZONES.length}`,
    );
    return `weekday ${DIGEST_WEEKDAY}, hours ${DIGEST_SEND_HOURS[0]}–${DIGEST_SEND_HOURS[DIGEST_SEND_HOURS.length - 1]}`;
  });

  // ---- the pages anyone can reach -----------------------------------------

  for (const [path, marker] of [
    ["/", /midweek|Wednesday morning/i],
    ["/explore", /What&#x27;s on this week|What's on this week/i],
    ["/privacy", /Privacy/i],
    ["/login", /email/i],
  ] as const) {
    await check(`${path} renders`, async () => {
      const { status, body } = await text(path);
      assert(status === 200, `HTTP ${status}`);
      assert(marker.test(body), `body does not match ${marker}`);
      return `${body.length} bytes`;
    });
  }

  await check("an unknown path is our 404, not the framework's", async () => {
    const { status, body } = await text("/definitely-not-a-page");
    assert(status === 404, `HTTP ${status}`);
    assert(
      !/This page could not be found/i.test(body),
      "serving Next's own unstyled 404",
    );
    assert(/likelylist/i.test(body), "the 404 offers no way back");
  });

  await check("robots and sitemap point at this origin", async () => {
    // Both bake NEXT_PUBLIC_SITE_URL at build time, so a build with the wrong
    // value ships a sitemap full of localhost.
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      const { status, body } = await text(path);
      assert(status === 200, `${path} HTTP ${status}`);
      assert(!/localhost/i.test(body), `${path} still points at localhost`);
      if (BASE.startsWith("https://")) {
        assert(body.includes(BASE), `${path} does not mention ${BASE}`);
      }
    }
  });

  await check("/explore does not server-render a guessed city", async () => {
    // The server cannot know where the reader is, so naming a city in the HTML
    // is a guess presented as a choice. It used to paint "New York, NY" — the
    // default slug — and swap to the real guess a frame after hydration, so the
    // control and the rest of the page disagreed on first load.
    const { body } = await text("/explore");
    const field = body.match(/id="explore-city"[^>]*value="([^"]*)"/);
    assert(field, "could not find the city field in the HTML");
    assert(
      field[1] === "",
      `the server rendered "${field[1]}" into a field the reader never filled`,
    );
  });

  await check("security headers are set", async () => {
    const response = await get("/");
    const missing = [
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "content-security-policy",
    ].filter((header) => !response.headers.get(header));
    assert(missing.length === 0, `missing: ${missing.join(", ")}`);
  });

  // ---- the contracts the UI depends on ------------------------------------

  await check("place search returns the shape the box expects", async () => {
    const response = await get("/api/places/search?q=cambridge");
    assert(response.ok, `HTTP ${response.status}`);
    const { places } = (await response.json()) as {
      places: { geoid: string; name: string; stateCode: string; latitude: number }[];
    };
    assert(places.length > 0, "no suggestions for 'cambridge'");
    const first = places[0];
    for (const key of ["geoid", "name", "stateCode", "latitude", "longitude"]) {
      assert(key in first, `a suggestion has no ${key}`);
    }
    assert(
      response.headers.get("cache-control")?.includes("max-age"),
      "answers are not cacheable, so every keystroke hits the database",
    );
    return `${places.length} rows`;
  });

  await check("place search puts the nearest match first", async () => {
    // The whole point of the ranking work. Cambridge, MA is twelfth by the old
    // land-area ordering, and off the end of the list.
    const response = await get("/api/places/search?q=cam&near=42.36,-71.06");
    const { places } = (await response.json()) as {
      places: { name: string; stateCode: string }[];
    };
    assert(places.length > 0, "no suggestions");
    const first = `${places[0].name}, ${places[0].stateCode}`;
    assert(first === "Cambridge, MA", `from Boston, 'cam' offered ${first} first`);
    return first;
  });

  await check("a word that is not the first still matches", async () => {
    // Needs migration 0017. Without it the route logs a warning and degrades,
    // which is safe but means this feature is silently absent.
    const response = await get("/api/places/search?q=francisco");
    const { places } = (await response.json()) as {
      places: { name: string; stateCode: string }[];
    };
    const names = places.map((place) => `${place.name}, ${place.stateCode}`);
    assert(
      names.includes("San Francisco, CA"),
      `'francisco' did not reach San Francisco — is 0017 applied? got ${names.slice(0, 3).join(" · ")}`,
    );
  });

  await check("explore states a week it can actually satisfy", async () => {
    const response = await get("/api/explore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: 42.3601,
        longitude: -71.0589,
        placeLabel: "Boston, MA",
        genreIds: [],
        radiusMiles: 50,
      }),
    });

    if (response.status === 429) return "skip: rate limited";
    assert(response.ok, `HTTP ${response.status}`);

    const payload = (await response.json()) as {
      events: { localDate: string }[];
      window: string;
      truncated?: boolean;
    };

    // The invariant is that the header describes the list under it. Not that it
    // spans seven days: the search is bounded by UTC instants and every row is
    // labelled with a venue's local date, so a seven-day span of instants can
    // touch eight local days, or fewer when a page of results runs out.
    const [start, end] = payload.window.split(" … ");
    const dates = payload.events.map((event) => event.localDate).sort();
    if (dates.length > 0) {
      assert(
        start === dates[0] && end === dates[dates.length - 1],
        `header says ${payload.window} but the rows run ${dates[0]} … ${dates[dates.length - 1]}`,
      );
    }

    assert(
      typeof payload.truncated === "boolean",
      "no `truncated` flag, so the UI cannot say when the week was cut short",
    );

    // Against the window the API states, not against today in UTC.
    //
    // Comparing a venue's local date to a UTC date is the exact mistake this
    // endpoint was fixed for, and it reappeared here: at 21:22 in Boston it is
    // already the 21st in UTC, so a show starting in eight minutes is dated the
    // 20th and looked like it was in the past. Whether a show has started is
    // enforced server-side by searching from `now`; what a smoke test can check
    // is that no row falls outside the window the response advertises.
    const outside = payload.events.filter(
      (event) => event.localDate < start || event.localDate > end,
    );
    assert(
      outside.length === 0,
      `${outside.length} rows outside the stated window ${payload.window} (e.g. ${outside[0]?.localDate})`,
    );
    return `${payload.events.length} shows · ${payload.window}${payload.truncated ? " · truncated" : ""}`;
  });

  // ---- nothing that writes or sends is reachable without the secret -------

  await check("the cron endpoint refuses an unauthenticated caller", async () => {
    const response = await get("/api/cron/digest?mode=weekly", { method: "POST" });
    assert(
      response.status === 401 || response.status === 503,
      `HTTP ${response.status} — a public caller must not be able to drive a send`,
    );
    return `HTTP ${response.status}`;
  });

  await check("the digest preview refuses a forged token", async () => {
    const response = await get("/preview/digest/not-a-real-token");
    assert(response.status === 404, `HTTP ${response.status}`);
  });

  // ---- report --------------------------------------------------------------

  const passed = results.filter((r) => r.outcome === "pass").length;
  const skipped = results.filter((r) => r.outcome === "skip").length;
  const failed = results.filter((r) => r.outcome === "fail");

  console.log(
    `\n${passed} passed · ${skipped} skipped · ${failed.length} failed`,
  );
  if (failed.length > 0) {
    console.log("\nfailed");
    for (const result of failed) console.log(`  ✗ ${result.name}\n      ${result.detail}`);
    process.exit(1);
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
