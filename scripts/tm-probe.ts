/**
 * Ticketmaster diagnostic probe.
 *
 * Run with: npm run tm:probe -- Boston 02134
 *           npm run tm:probe            (defaults to Boston / 02134)
 *
 * Answers two questions empirically rather than from documentation:
 *
 *   1. What music genres and subgenres does this taxonomy actually contain?
 *      The picker currently offers top-level genres only; this prints the whole
 *      tree so it is obvious what finer filtering is available.
 *
 *   2. Why does a search return so few events? It runs the same week several
 *      ways — city, postal code, postal code plus radius — and prints the count
 *      for each, then breaks the results down by genre. That distinguishes "the
 *      location filter is too narrow" from "the genre filter is throwing
 *      everything away", which are very different fixes.
 *
 * Costs roughly ten Ticketmaster requests out of 5000/day.
 */

import { createTicketmasterClient, type TmClient } from "../src/lib/ticketmaster/client";
import { MUSIC_SEGMENT_ID, type TmEvent, type TmEventsResponse } from "../src/lib/ticketmaster/types";
import type { TmClassificationsResponse } from "../src/lib/ticketmaster/types";
import { primaryClassification } from "../src/lib/ticketmaster/lineup";
import { digestWindow } from "../src/lib/time";
import { encodeGeohash } from "../src/lib/geohash";

/** Metro centres, for the geoPoint variants. Boston unless a third arg is given. */
const CENTRES: Record<string, { lat: number; lon: number }> = {
  boston: { lat: 42.3601, lon: -71.0589 },
  "new york": { lat: 40.7128, lon: -74.006 },
  chicago: { lat: 41.8781, lon: -87.6298 },
  "los angeles": { lat: 34.0522, lon: -118.2437 },
  austin: { lat: 30.2672, lon: -97.7431 },
  seattle: { lat: 47.6062, lon: -122.3321 },
};

const [cityArg, zipArg] = process.argv.slice(2);
const CITY = cityArg || "Boston";
const ZIP = zipArg || "02134";

function toTmDateTime(date: Date): string {
  return `${date.toISOString().split(".")[0]}Z`;
}

async function main() {
  const key = (process.env.TICKETMASTER_API_KEY ?? "").trim();
  if (!key) {
    console.error("TICKETMASTER_API_KEY is not set.");
    process.exit(1);
  }
  const client = createTicketmasterClient(key);
  const window = digestWindow(new Date(), "America/New_York");

  console.log(`\nTicketmaster probe — ${CITY} / ${ZIP}`);
  console.log(`Window: ${window.startDate} … ${window.endDate}\n`);

  await dumpTaxonomy(client);
  await compareLocationFilters(client, window);

  console.log(`\nRequests used: ${client.requestCount()}`);
  console.log("Rate limit:", client.rateLimit(), "\n");
}

/* -------------------------------------------------------------------------- */

async function dumpTaxonomy(client: TmClient) {
  console.log("=".repeat(72));
  console.log("MUSIC TAXONOMY");
  console.log("=".repeat(72));

  let genreCount = 0;
  let subgenreCount = 0;

  for (let page = 0; page < 20; page++) {
    const response = await client.get<TmClassificationsResponse>(
      "/classifications.json",
      { size: 20, page },
    );
    const rows = response._embedded?.classifications ?? [];

    for (const row of rows) {
      const segment = row.segment;
      if (!segment || segment.id !== MUSIC_SEGMENT_ID) continue;

      for (const genre of segment._embedded?.genres ?? []) {
        genreCount += 1;
        const subs = genre._embedded?.subgenres ?? [];
        subgenreCount += subs.length;
        console.log(`\n${genre.name}  [${genre.id}]  — ${subs.length} subgenres`);
        if (subs.length > 0) {
          console.log(
            `    ${subs.map((s) => `${s.name} [${s.id}]`).join("\n    ")}`,
          );
        }
      }
    }

    const totalPages = response.page?.totalPages ?? 0;
    if (rows.length < 20 || page + 1 >= totalPages) break;
  }

  console.log(
    `\n>>> ${genreCount} genres, ${subgenreCount} subgenres under the Music segment.`,
  );
  console.log(
    ">>> The picker currently offers the genres only. Subgenres are the finer layer\n" +
      ">>> (they are what `subGenreId` filters on) and are not seeded.\n",
  );
}

/* -------------------------------------------------------------------------- */

type Variant = { label: string; params: Record<string, string | number | undefined> };

async function compareLocationFilters(
  client: TmClient,
  window: ReturnType<typeof digestWindow>,
) {
  console.log("=".repeat(72));
  console.log("WHY SO FEW EVENTS? — same week, different location filters");
  console.log("=".repeat(72));

  const base = {
    segmentId: MUSIC_SEGMENT_ID,
    startDateTime: toTmDateTime(window.start),
    endDateTime: toTmDateTime(window.end),
    countryCode: "US",
    size: 100,
    sort: "date,asc",
    includeTBA: "no",
    includeTBD: "no",
    includeTest: "no",
  } as const;

  const variants: Variant[] = [
    { label: `city=${CITY}`, params: { ...base, city: CITY } },
    {
      label: `city=${CITY} + radius=50mi`,
      params: { ...base, city: CITY, radius: 50, unit: "miles" },
    },
    { label: `postalCode=${ZIP} (exact)`, params: { ...base, postalCode: ZIP } },
    {
      label: `postalCode=${ZIP} + radius=25mi`,
      params: { ...base, postalCode: ZIP, radius: 25, unit: "miles" },
    },
    {
      label: `postalCode=${ZIP} + radius=50mi`,
      params: { ...base, postalCode: ZIP, radius: 50, unit: "miles" },
    },
    // No segment filter at all, to show how much of the reduction is "music only".
    {
      label: `city=${CITY}, ALL segments (not just music)`,
      params: { ...base, city: CITY, segmentId: undefined },
    },
  ];

  // The hypothesis worth testing: radius is ignored with `city` and `postalCode`
  // (already shown) but takes effect with coordinates. If these come back much
  // larger, geoPoint + radius is the fix for "only 21 events in Boston".
  const centre = CENTRES[CITY.toLowerCase()];
  if (centre) {
    const geoPoint = encodeGeohash(centre.lat, centre.lon, 6);
    for (const radius of [10, 25, 50, 100]) {
      variants.push({
        label: `geoPoint=${geoPoint} + radius=${radius}mi  (${CITY} centre)`,
        params: { ...base, geoPoint, radius, unit: "miles" },
      });
    }
  } else {
    console.log(
      `(no stored centre for ${CITY}; add one to CENTRES to test geoPoint)\n`,
    );
  }

  let widestEvents: TmEvent[] = [];
  let widestLabel = "";

  for (const variant of variants) {
    try {
      const response = await client.get<TmEventsResponse>(
        "/events.json",
        variant.params,
      );
      const events = response._embedded?.events ?? [];
      const total = response.page?.totalElements ?? events.length;

      console.log(
        `${String(events.length).padStart(4)} returned · ${String(total).padStart(5)} total  ${variant.label}`,
      );

      if (events.length > widestEvents.length) {
        widestEvents = events;
        widestLabel = variant.label;
      }
    } catch (error) {
      console.log(
        `   ERR  ${variant.label} — ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (widestEvents.length === 0) {
    console.log(
      "\n>>> Nothing came back for any variant. Either the window genuinely has no\n" +
        ">>> listed music events, or the city string does not match Ticketmaster's.\n",
    );
    return;
  }

  console.log(`\nGenre breakdown of the widest result (${widestLabel}):\n`);

  const byGenre = new Map<string, number>();
  let missingGenre = 0;

  for (const event of widestEvents) {
    const { genreId, subGenreId } = primaryClassification(event);
    if (!genreId) {
      missingGenre += 1;
      continue;
    }
    const label = `${genreName(event)} [${genreId}]${subGenreId ? ` / sub ${subGenreId}` : ""}`;
    byGenre.set(label, (byGenre.get(label) ?? 0) + 1);
  }

  for (const [label, count] of [...byGenre.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${label}`);
  }
  if (missingGenre > 0) {
    console.log(`  ${String(missingGenre).padStart(3)}  (no primary genre at all)`);
  }

  console.log(
    "\n>>> Read this against the genres you selected in the UI. If your selection is\n" +
      ">>> absent or rare here, the genre filter is what reduced the list — not the\n" +
      ">>> location. Events with no primary genre are dropped whenever any genre\n" +
      ">>> filter is active, and that count is shown above.\n",
  );
}

function genreName(event: TmEvent): string {
  const classifications = event.classifications ?? [];
  const primary = classifications.find((c) => c.primary) ?? classifications[0];
  return primary?.genre?.name ?? "?";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
