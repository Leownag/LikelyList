import type { AdminClient } from "@/lib/supabase/admin";
import type { AppEnv } from "@/lib/env";
import { createTicketmasterClient } from "@/lib/ticketmaster/client";
import { fetchMusicGenres } from "@/lib/ticketmaster/classifications";
import {
  isSendableEvent,
  searchMusicEvents,
  toCachedEvent,
} from "@/lib/ticketmaster/events";
import type { TmEvent } from "@/lib/ticketmaster/types";
import { digestRunDate, digestWindow, sendInstantFor } from "@/lib/time";
import { encodeGeohash } from "@/lib/geohash";
import { parseGeoCellKey } from "@/lib/geo-cell";
import type { DigestRun, Profile } from "@/lib/db";

/**
 * The building half of the pipeline: work out what to send, and to whom.
 *
 * The important structural decision is that Ticketmaster is queried once per
 * DISTINCT subscribed city, not once per subscriber. Two people following Boston
 * share one call. Genre filtering then happens in our own code (see ./build)
 * against each event's primary genre ID. Filtering server-side per user would
 * multiply requests by users x genres against a 5000/day quota for no benefit.
 *
 * Nothing is emailed here. Each subscriber gets a queued job with its own
 * `send_after`, and the drainer releases it when their local morning arrives.
 */

/** How long a cached event row lives. */
const CACHE_TTL_HOURS = 36;

/**
 * How far ahead the "on sale this week" query looks for event dates.
 *
 * A show whose tickets drop this week is typically months out, so this window has
 * to be much wider than the digest's own seven days. It is a bound on the request,
 * not the thing that selects onsales — that is `onsaleOnAfterStartDate`.
 */
const ONSALE_EVENT_HORIZON_DAYS = 365;

/**
 * Pages of onsale results per city.
 *
 * One, on purpose, and one is plenty: a real city week returns a handful of
 * upcoming onsales, because most listed events are already on sale. Paging deeper
 * would spend quota on events that could never be rendered.
 */
const ONSALE_MAX_PAGES = 1;

/**
 * Search radius, matching /explore.
 *
 * Ticketmaster ignores `radius` unless it is paired with coordinates — 21 events for
 * `city=Boston` against 85 for this radius on the same week — which is the whole reason
 * subscriptions moved to points.
 */
const SEARCH_RADIUS_MILES = 50;

/** Enough precision to place a cell centre; the radius does the rest. */
const GEOHASH_PRECISION = 6;

/** Refresh the genre taxonomy at most this often. */
const TAXONOMY_MAX_AGE_DAYS = 30;

export type PlanResult = {
  runId: string;
  runDate: string;
  windowStart: string;
  windowEnd: string;
  citiesQueried: number;
  eventsCached: number;
  jobsQueued: number;
  ticketmasterRequests: number;
  /** Non-fatal problems worth surfacing in logs and the run row. */
  warnings: string[];
};

export async function planWeeklyDigest(
  supabase: AdminClient,
  env: AppEnv,
  now = new Date(),
): Promise<PlanResult> {
  const warnings: string[] = [];

  // Keyed on the Wednesday the run is *for*, not the evening it is built on, so
  // a retry either side of UTC midnight resumes the same run instead of opening
  // a second one. The window is anchored there too: the listings have to start
  // on the morning the email is read.
  const digestDate = digestRunDate(now);
  const runDate = digestDate.toISOString().slice(0, 10);
  const window = digestWindow(digestDate, "UTC");

  const { data: existingRun } = await supabase
    .from("digest_runs")
    .select("id, status, window_start, window_end")
    .eq("run_date", runDate)
    .maybeSingle<Pick<DigestRun, "id" | "status" | "window_start" | "window_end">>();

  let runId: string;
  if (existingRun) {
    runId = existingRun.id;
  } else {
    const { data: created, error } = await supabase
      .from("digest_runs")
      .insert({
        run_date: runDate,
        status: "building",
        window_start: window.startDate,
        window_end: window.endDate,
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !created) {
      throw new Error(`Could not create the digest run: ${error?.message}`);
    }
    runId = created.id;
  }

  if (!env.ticketmasterApiKey) {
    await failRun(supabase, runId, "TICKETMASTER_API_KEY is not set.");
    throw new Error("TICKETMASTER_API_KEY is not set, so no listings can be fetched.");
  }

  const client = createTicketmasterClient(env.ticketmasterApiKey);

  await refreshTaxonomyIfStale(supabase, client, warnings);

  // Only cities that somebody actually follows, and only for subscribers whose
  // digest is switched on.
  const { data: subscriberRows } = await supabase
    .from("profiles")
    .select("id, email, timezone, digest_send_hour")
    .eq("digest_enabled", true);

  const subscribers = (subscriberRows ?? []) as Pick<
    Profile,
    "id" | "email" | "timezone" | "digest_send_hour"
  >[];

  const { data: subscriptionRows } = await supabase
    .from("subscriptions")
    .select("user_id, geo_cell, place_name, state_code");

  // One query per occupied grid cell, not per subscriber and no longer per city.
  //
  // Subscriptions store a point now, so "distinct city" is not a thing to group by.
  // Grouping by exact point would make the cost grow with how spread out subscribers
  // are; the quarter-degree cell means two people in neighbouring suburbs share a call,
  // and the cell key doubles as the query centre and the cache key. See lib/geo-cell.ts.
  const subscribedUserIds = new Set(subscribers.map((s) => s.id));
  const cellLabels = new Map<string, string>();

  for (const row of (subscriptionRows ?? []) as {
    user_id: string;
    geo_cell: string;
    place_name: string | null;
    state_code: string | null;
  }[]) {
    if (!subscribedUserIds.has(row.user_id)) continue;
    if (!cellLabels.has(row.geo_cell)) {
      // Just for warnings and run stats — the first subscriber's place name is a more
      // useful thing to read in a log than "42.25,-71".
      cellLabels.set(
        row.geo_cell,
        [row.place_name, row.state_code].filter(Boolean).join(", ") || row.geo_cell,
      );
    }
  }

  const cells = [...cellLabels.keys()]
    .map((key) => ({ key, centre: parseGeoCellKey(key), label: cellLabels.get(key)! }))
    .filter(
      (cell): cell is { key: string; centre: { latitude: number; longitude: number }; label: string } => {
        if (cell.centre) return true;
        // A malformed cell would reach the geohash encoder, which throws, and take out
        // the whole run for one bad row.
        warnings.push(`${cell.label}: unusable geo_cell ${JSON.stringify(cell.key)}`);
        return false;
      },
    );

  const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);
  let eventsCached = 0;

  const onsaleHorizon = new Date(
    now.getTime() + ONSALE_EVENT_HORIZON_DAYS * 24 * 60 * 60 * 1000,
  );

  for (const cell of cells) {
    try {
      const geoPoint = encodeGeohash(
        cell.centre.latitude,
        cell.centre.longitude,
        GEOHASH_PRECISION,
      );

      const events = await searchMusicEvents(client, {
        geoPoint,
        radius: SEARCH_RADIUS_MILES,
        unit: "miles",
        startDateTime: window.start,
        endDateTime: window.end,
      });

      // Second query, same city: what goes on sale from this week onward, whenever
      // the show itself happens. These land in the same cache table and are told
      // apart by onsale_start, so an event that is both playing and going on sale
      // this week is one row either way.
      //
      // `onsaleOnAfterStartDate` has no upper bound and the datetime-range
      // parameters that look like they would provide one are silently ignored (see
      // EventSearchParams for the measurements). The upper bound is therefore
      // applied in buildDigest, against the reader's own week.
      const onsale = await searchMusicEvents(client, {
        geoPoint,
        radius: SEARCH_RADIUS_MILES,
        unit: "miles",
        // Still bounded, so a city with years of announced inventory cannot drag a
        // page of 2029 dates into the cache. It is not what selects the onsales.
        startDateTime: now,
        endDateTime: onsaleHorizon,
        onsaleOnAfterStartDate: window.start,
        maxPages: ONSALE_MAX_PAGES,
      });

      const rows = dedupeByEventId([...events, ...onsale])
        .filter(isSendableEvent)
        .map((event) => toCachedEvent(event, cell.key, expiresAt));

      if (rows.length > 0) {
        // Upsert in chunks: a busy market can return several hundred events and
        // one enormous statement is more likely to time out than five small ones.
        for (let i = 0; i < rows.length; i += 100) {
          const { error } = await supabase
            .from("events_cache")
            .upsert(rows.slice(i, i + 100), { onConflict: "geo_cell,tm_event_id" });
          if (error) throw new Error(error.message);
        }
        eventsCached += rows.length;
      }
    } catch (error) {
      // One bad cell must not lose the whole run — everyone else still gets mail.
      warnings.push(
        `${cell.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Enqueue one job per subscriber, with the instant their local morning starts.
  //
  // Guarded per subscriber rather than around the whole loop: Intl throws a
  // RangeError on an unrecognised timezone, and this pass covers the entire
  // audience — so an unguarded map meant one bad row could abort the run and
  // nobody would receive an email that week. Migration 0005 constrains the
  // column as well; this is the second layer, because no single row should ever
  // be able to take out everyone else.
  let jobsQueued = 0;
  const jobs = subscribers.map((subscriber) => ({
    run_id: runId,
    user_id: subscriber.id,
    status: "queued" as const,
    send_after: safeSendInstant(now, subscriber, warnings),
  }));

  for (let i = 0; i < jobs.length; i += 200) {
    const batch = jobs.slice(i, i + 200);
    // ignoreDuplicates so re-running the planner on the same day does not reset
    // jobs that have already been sent.
    const { error } = await supabase
      .from("digest_jobs")
      .upsert(batch, { onConflict: "run_id,user_id", ignoreDuplicates: true });
    if (error) {
      warnings.push(`Queueing failed for a batch of jobs: ${error.message}`);
    } else {
      jobsQueued += batch.length;
    }
  }

  const result: PlanResult = {
    runId,
    runDate,
    windowStart: window.startDate,
    windowEnd: window.endDate,
    citiesQueried: cells.length,
    eventsCached,
    jobsQueued,
    ticketmasterRequests: client.requestCount(),
    warnings,
  };

  await supabase
    .from("digest_runs")
    .update({
      status: "queued",
      stats: { ...result, rateLimit: client.rateLimit() },
    })
    .eq("id", runId);

  return result;
}

/**
 * This subscriber's send instant, or a UTC-based one if their timezone is
 * unusable.
 *
 * Exported for testing: the failure it prevents is invisible until send day.
 */
export function safeSendInstant(
  now: Date,
  subscriber: { id: string; timezone: string; digest_send_hour: number },
  warnings: string[],
): string {
  try {
    const instant = sendInstantFor(
      now,
      subscriber.timezone,
      subscriber.digest_send_hour,
    );
    // An Invalid Date also throws on toISOString, so this stays inside the try.
    return instant.toISOString();
  } catch {
    warnings.push(
      `${subscriber.id}: unusable timezone ${JSON.stringify(
        subscriber.timezone,
      )}, scheduled against UTC instead`,
    );
    return sendInstantFor(now, "UTC", subscriber.digest_send_hour).toISOString();
  }
}

/**
 * Collapses the this-week and on-sale-this-week results into one row per event.
 *
 * The two queries overlap whenever a show goes on sale days before it happens, and
 * `events_cache` is keyed on (city_id, tm_event_id) — so without this the upsert
 * would carry two rows with the same key in a single statement, which Postgres
 * rejects outright ("ON CONFLICT DO UPDATE command cannot affect row a second
 * time"). First occurrence wins; both copies carry the same `sales` block.
 */
export function dedupeByEventId(events: TmEvent[]): TmEvent[] {
  const byId = new Map<string, TmEvent>();
  for (const event of events) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()];
}

/**
 * Re-reads the music genre taxonomy when it is old or missing.
 *
 * Genre IDs are never hardcoded — Ticketmaster publishes no genre ID table and
 * third-party lists disagree — so the app depends on this table being populated.
 * Doing it here means a long-running deployment keeps up with taxonomy changes
 * without anyone remembering to run the seed script.
 */
async function refreshTaxonomyIfStale(
  supabase: AdminClient,
  client: ReturnType<typeof createTicketmasterClient>,
  warnings: string[],
): Promise<void> {
  const { data: newest } = await supabase
    .from("genres")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();

  const ageDays = newest
    ? (Date.now() - new Date(newest.created_at).getTime()) / 86_400_000
    : Infinity;

  if (ageDays < TAXONOMY_MAX_AGE_DAYS) return;

  try {
    const genres = await fetchMusicGenres(client);
    if (genres.length === 0) {
      warnings.push("Ticketmaster returned no music genres; kept the existing taxonomy.");
      return;
    }
    await supabase.from("genres").upsert(
      genres.map((genre, index) => ({
        tm_genre_id: genre.tmGenreId,
        tm_segment_id: genre.tmSegmentId,
        name: genre.name,
        slug: genre.slug,
        sort_order: index,
      })),
      { onConflict: "tm_genre_id" },
    );
  } catch (error) {
    warnings.push(
      `Genre taxonomy refresh failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function failRun(
  supabase: AdminClient,
  runId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("digest_runs")
    .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", runId);
}
