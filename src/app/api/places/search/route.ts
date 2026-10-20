import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlaceSuggestion } from "@/lib/explore/types";
import { distanceMiles, placeBand } from "@/lib/places";
import { visitorHash } from "@/lib/visitor";

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
 * That bound is the per-visitor hourly cap below, set far above what typing can
 * reach: the box fires every 180ms, so a solid minute of typing is some fifty
 * queries.
 *
 * Answers are cached at the edge for a day. The place list changes once a year
 * when the Census publishes a new Gazetteer, and `near` only ever takes one of
 * ten values, so the (q, near) space a real audience visits is small and this
 * removes most of the traffic rather than metering it.
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

/**
 * Shortest needle worth asking the "contains anywhere" question for.
 *
 * At two characters an unanchored match is mostly noise — "ma" is inside several
 * thousand place names — and the prefix tier already answers it well.
 */
const MIN_CONTAINS = 4;

/** Generous: typing cannot reach it, a script can. */
const HOURLY_PER_VISITOR = 600;

/** The place list changes once a year. */
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=86400";

type PlaceRow = {
  geoid: string;
  name: string;
  state_code: string;
  latitude: number;
  longitude: number;
  rank: number;
};

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

  // Unmetered before this: a public endpoint running a LIKE against a
  // 32,329-row table on every keystroke of every visitor.
  const day = new Date().toISOString().slice(0, 10);
  const visitorKey = await visitorHash(request, env.unsubscribeHmacSecret);
  const { data: usedThisHour } = await supabase.rpc("bump_global_usage", {
    p_kind: `places_ip:${visitorKey}:${day}T${new Date().getUTCHours()}`,
    p_day: day,
    p_amount: 1,
  });
  if (typeof usedThisHour === "number" && usedThisHour > HOURLY_PER_VISITOR) {
    // Shaped like every other answer here. A dropdown that says "rate limited"
    // is a worse experience than one that says nothing matched, and a caller
    // who hit this is not reading the message anyway.
    return NextResponse.json({ places: [] }, { status: 429 });
  }

  // Escaped so a literal % cannot turn one lookup into a full scan.
  const escaped = needle.replace(/[%_\\]/g, "\\$&");
  const COLUMNS = "geoid, name, state_code, latitude, longitude, rank";

  // Tier 0: `like 'nash%'` against the search_key index — what the reader almost
  // always means.
  const { data, error } = await supabase
    .from("places")
    .select(COLUMNS)
    // rank first so the curated metros and incorporated cities lead; name second so
    // the order is stable rather than whatever Postgres happens to return.
    .like("search_key", `${escaped}%`)
    .order("rank")
    .order("name")
    .limit(CANDIDATES);

  if (error) {
    // Degrade to no suggestions rather than an error: the reader can still search by
    // ZIP, and a broken dropdown should not look like a broken page.
    console.error("[PLACES_SEARCH]", error.message);
    return NextResponse.json({ places: [] });
  }

  const rows = (data ?? []) as PlaceRow[];

  // Tier 1: anywhere in the flattened name, so "francisco" reaches San Francisco
  // and "boston ma" reaches Boston. Strictly a lower tier — typing "cam" must
  // still offer Cambridge before Birmingham, which merely contains "am".
  //
  // Only worth asking once the prefix tier has left room, and never for a needle
  // so short that "contains" is noise.
  const seen = new Set(rows.map((row) => row.geoid));
  let extra: PlaceRow[] = [];
  if (rows.length < CANDIDATES && needle.length >= MIN_CONTAINS) {
    const { data: more, error: containsError } = await supabase
      .from("places")
      .select(COLUMNS)
      .like("search_flat", `%${escaped.replace(/[\s,]+/g, " ")}%`)
      .order("rank")
      .order("name")
      .limit(CANDIDATES - rows.length);

    if (containsError) {
      // Almost certainly migration 0017 not applied yet, in which case the column
      // does not exist. The prefix tier above is a complete answer on its own, so
      // this is logged and dropped rather than failing the request.
      console.warn("[PLACES_SEARCH] contains tier unavailable:", containsError.message);
    } else {
      extra = ((more ?? []) as PlaceRow[]).filter((row) => !seen.has(row.geoid));
    }
  }

  // Band first, then distance from the reader inside the band.
  //
  // Without `near` this is the old behaviour exactly: the rows arrive in rank
  // order and nothing reorders them. With it, the land-area tiebreak buried in
  // `rank` stops deciding — which is the whole point, because area is why
  // Camarillo, CA came before Cambridge, MA for somebody typing "cam" in Boston.
  const near = parseNear(parsed.data.near);
  const tiered = [
    ...rows.map((row, index) => ({ row, tier: 0, index })),
    ...extra.map((row, index) => ({ row, tier: 1, index: rows.length + index })),
  ];

  const ordered = (
    near
      ? [...tiered].sort((a, b) => {
          if (a.tier !== b.tier) return a.tier - b.tier;
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
      : tiered
  ).map((entry) => entry.row);

  const places: PlaceSuggestion[] = ordered.slice(0, LIMIT).map((row) => ({
    geoid: row.geoid,
    name: row.name,
    stateCode: row.state_code,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));

  return NextResponse.json(
    { places },
    // Only on the success path: a 429 or an empty degraded answer must not be
    // the thing a cache keeps for a day.
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
