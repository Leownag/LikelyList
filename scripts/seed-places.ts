/**
 * Seeds public.places from the US Census Bureau Gazetteer.
 *
 * Run with: npm run seed:places
 *
 * Why this exists: `cities` is 43 curated metros, and anything else typed into the
 * city box simply could not be found. Searching no longer needs a name Ticketmaster
 * recognises — it goes out as coordinates plus a radius — so there is no reason to
 * withhold the rest of the country.
 *
 * Source is the Gazetteer place file: a work of the US government, therefore public
 * domain, with no key and no attribution clause. It is downloaded at seed time
 * rather than committed, because 6.5 MB of reference data in a git history to save
 * one HTTP call is the wrong trade.
 *
 * What it does NOT carry is population, and the Census population API now requires
 * a registered key. So `rank` is assembled from what the file does have. That
 * judgement, and the name cleaning, live in src/lib/places.ts where they are tested
 * — this file is only download, parse and write.
 */

import { inflateRawSync } from "node:zlib";
import { adminClientFromProcessEnv } from "./_shared";
import {
  cleanPlaceName,
  placeRank,
  placeSearchKey,
} from "../src/lib/places";

const GAZETTEER_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip";

type Place = {
  geoid: string;
  name: string;
  state_code: string;
  latitude: number;
  longitude: number;
  rank: number;
  search_key: string;
};

/**
 * Extracts the single member of a ZIP archive.
 *
 * node:zlib inflates deflate streams but does not read ZIP containers, and pulling
 * in a dependency to unwrap one file is not worth it. A ZIP local file header is
 * fixed-layout: signature, then the sizes and name length at known offsets, then the
 * name, then the raw deflate stream. Handles the stored-uncompressed case too, which
 * some producers use for small files.
 */
function unzipSingle(archive: Buffer): string {
  if (archive.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("Not a ZIP file — did the download return an error page?");
  }

  const method = archive.readUInt16LE(8);
  const compressedSize = archive.readUInt32LE(18);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;
  const body = archive.subarray(start, start + compressedSize);

  if (method === 0) return body.toString("latin1");
  if (method === 8) return inflateRawSync(body).toString("latin1");
  throw new Error(`Unsupported ZIP compression method ${method}.`);
}

async function main() {
  const supabase = adminClientFromProcessEnv();

  console.log(`Downloading ${GAZETTEER_URL}`);
  const response = await fetch(GAZETTEER_URL, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Gazetteer download failed: HTTP ${response.status}`);
  }

  const text = unzipSingle(Buffer.from(await response.arrayBuffer()));
  const lines = text.split(/\r?\n/);
  const header = lines[0].split("\t").map((column) => column.trim());

  const columnIndex = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`Gazetteer column ${name} is missing.`);
    return index;
  };

  const iState = columnIndex("USPS");
  const iGeoid = columnIndex("GEOID");
  const iName = columnIndex("NAME");
  const iLsad = columnIndex("LSAD");
  const iArea = columnIndex("ALAND_SQMI");
  const iLat = columnIndex("INTPTLAT");
  const iLon = columnIndex("INTPTLONG");

  const places: Place[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    if (cells.length <= iLon) continue;

    const stateCode = cells[iState].trim();
    const name = cleanPlaceName(cells[iName]);
    const latitude = Number(cells[iLat]);
    const longitude = Number(cells[iLon]);
    const geoid = cells[iGeoid].trim();

    if (!name || !stateCode || !geoid) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (seen.has(geoid)) continue;
    seen.add(geoid);

    const searchKey = placeSearchKey(name, stateCode);

    places.push({
      geoid,
      name,
      state_code: stateCode,
      latitude,
      longitude,
      rank: placeRank(searchKey, cells[iLsad].trim(), Number(cells[iArea])),
      search_key: searchKey,
    });
  }

  console.log(`Parsed ${places.length} places. Upserting…`);

  // Chunked: one statement with thirty thousand rows is a timeout waiting to happen.
  const CHUNK = 1000;
  for (let i = 0; i < places.length; i += CHUNK) {
    const { error } = await supabase
      .from("places")
      .upsert(places.slice(i, i + CHUNK), { onConflict: "geoid" });
    if (error) {
      throw new Error(`Upsert failed at row ${i}: ${error.message}`);
    }
    process.stdout.write(
      `\r  ${Math.min(i + CHUNK, places.length)} / ${places.length}`,
    );
  }

  const majors = places.filter((place) => place.rank === 0).length;
  console.log(
    `\nSeeded ${places.length} places, ${majors} flagged as curated metros.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
