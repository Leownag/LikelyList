import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlaceSuggestion } from "@/lib/explore/types";

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
const LIMIT = 8;

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(64),
});

export async function GET(request: NextRequest) {
  const env = readEnv();
  if (!env.supabaseServiceRoleKey) {
    return NextResponse.json({ places: [] });
  }

  const parsed = QuerySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
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
    .select("geoid, name, state_code, latitude, longitude")
    // rank first so the curated metros and incorporated cities lead; name second so
    // the order is stable rather than whatever Postgres happens to return.
    .like("search_key", prefix)
    .order("rank")
    .order("name")
    .limit(LIMIT);

  if (error) {
    // Degrade to no suggestions rather than an error: the reader can still search by
    // ZIP, and a broken dropdown should not look like a broken page.
    console.error("[PLACES_SEARCH]", error.message);
    return NextResponse.json({ places: [] });
  }

  const places: PlaceSuggestion[] = (
    (data ?? []) as {
      geoid: string;
      name: string;
      state_code: string;
      latitude: number;
      longitude: number;
    }[]
  ).map((row) => ({
    geoid: row.geoid,
    name: row.name,
    stateCode: row.state_code,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));

  return NextResponse.json({ places });
}
