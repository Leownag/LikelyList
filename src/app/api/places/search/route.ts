import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlaceSuggestion } from "@/lib/explore/types";
import { distanceMiles, placeBand } from "@/lib/places";

/**
 * City suggestions for the search box.
 *
 * Server-side because the table is 32,329 rows — every incorporated place and Census
 * designated place in the US. Filtering that in the browser would mean shipping a
 * couple of megabytes to somebody who is going to type four characters, so the
 * previous client-side filter over 43 curated metros became a server query over all
 * of them instead.
 *
 * Costs nothing external. This is our own Postgres, not Ticketmaster, so unlike
 * /api/explore it does not need a quota budget — only enough of a bound that a
 * scripted caller cannot use it to enumerate the table or hold connections open.
 */

/** Enough to disambiguate, few enough to scan without scrolling. */
const LIMIT = 12;

/**
 * Rows pulled before re-ranking.
 *
 * The database can order by `rank` against an index; it cannot order by distance
 * from the reader without a function and a migration. So the most significant
 * matches come back and the ordering that actually matters is applied here.
 *
 * The tradeoff is real and bounded: for a two-letter prefix with more than this
 * many matches, a nearby but insignificant hamlet can be cut before distance is
 * ever considered. Two hundred rows of five small columns is a few KB, and a
 * prefix that broad is one the reader is still typing.
 */
const CANDIDATES = 200;

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(64),
  /** "42.36,-71.06" — the reader's rough position, for ordering only. */
  near: z
    .string()
    .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/)
    .optional(),
});

/** Parses `near`, rejecting anything off the globe. */
function parseNear(value: string | undefined) {
  if (!value) return null;
  const [lat, lon] = value.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: lat, longitude: lon };
}

export async function GET(request: NextRequest) {
  const env = readEnv();
  if (!env.supabaseServiceRoleKey) {
    return NextResponse.json({ places: [] });
  }

  const parsed = QuerySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    near: request.nextUrl.searchParams.get("near") ?? undefined,
  });
  // An empty query is not an error, it is "nothing typed yet" — the box asks on
  // every keystroke and a 400 would put a red error under a field somebody is still
  // filling in.
  if (!parsed.success) return NextResponse.json({ places: [] });

  const needle = parsed.data.q.toLowerCase();
  const supabase = createAdminClient(env);

  // `like 'nash%'` against the search_key index, escaping the LIKE metacharacters so
  // a literal % cannot turn one lookup into a full scan.
  const prefix = `${needle.replace(/[%_\\]/g, "\\$&")}%`;

  const { data, error } = await supabase
    .from("places")
    .select("geoid, name, state_code, latitude, longitude, rank")
    // rank first so the curated metros and incorporated cities lead; name second so
    // the order is stable rather than whatever Postgres happens to return.
    .like("search_key", prefix)
    .order("rank")
    .order("name")
    .limit(CANDIDATES);

  if (error) {
    // Degrade to no suggestions rather than an error: the reader can still search by
    // ZIP, and a broken dropdown should not look like a broken page.
    console.error("[PLACES_SEARCH]", error.message);
    return NextResponse.json({ places: [] });
  }

  const rows = (data ?? []) as {
    geoid: string;
    name: string;
    state_code: string;
    latitude: number;
    longitude: number;
    rank: number;
  }[];

  // Band first, then distance from the reader inside the band.
  //
  // Without `near` this is the old behaviour exactly: the rows arrive in rank
  // order and nothing reorders them. With it, the land-area tiebreak buried in
  // `rank` stops deciding — which is the whole point, because area is why
  // Camarillo, CA came before Cambridge, MA for somebody typing "cam" in Boston.
  const near = parseNear(parsed.data.near);
  const ordered = near
    ? rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
          const band = placeBand(a.row.rank) - placeBand(b.row.rank);
          if (band !== 0) return band;
          const byDistance =
            distanceMiles(near, {
              latitude: Number(a.row.latitude),
              longitude: Number(a.row.longitude),
            }) -
            distanceMiles(near, {
              latitude: Number(b.row.latitude),
              longitude: Number(b.row.longitude),
            });
          // Falls back to the incoming order so the sort stays deterministic for
          // two places the same distance away.
          return byDistance !== 0 ? byDistance : a.index - b.index;
        })
        .map((entry) => entry.row)
    : rows;

  const places: PlaceSuggestion[] = ordered.slice(0, LIMIT).map((row) => ({
    geoid: row.geoid,
    name: row.name,
    stateCode: row.state_code,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));

  return NextResponse.json({ places });
}
