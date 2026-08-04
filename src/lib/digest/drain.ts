import type { AdminClient } from "@/lib/supabase/admin";
import type { AppEnv } from "@/lib/env";
import type { DigestJob, DigestRun } from "@/lib/db";
import { buildDigest } from "./build";
import { sendDigestEmail } from "./send";
import {
  findDueImports,
  importTopArtists,
  markNeedsReconnect,
} from "@/lib/spotify/import";

/**
 * The other half of the pipeline: actually send the queued emails.
 *
 * This runs every five minutes rather than once on Friday, which buys three
 * things at once:
 *
 *  - It is self-healing. A Worker invocation that dies partway through leaves
 *    the remaining jobs queued and the next pass picks them up. Cloudflare caps
 *    a cron invocation at 15 minutes of wall clock, so a single pass through
 *    every subscriber was never safe to rely on.
 *  - Each subscriber is emailed when *their* local morning arrives, which is
 *    what makes multiple timezones and DST work without touching the (always
 *    UTC) cron expression.
 *  - Rate and quota pressure is spread out instead of arriving in one spike.
 */

/** Jobs per invocation. Small enough to finish well inside the CPU budget. */
const BATCH_SIZE = 10;

/** How long a claimed job stays leased before another drainer may retry it. */
const LEASE_SECONDS = 300;

const MAX_ATTEMPTS = 3;

/**
 * How long a failed extraction's screenshot is kept.
 *
 * Short, because the only reason to keep it is a retry the reader has not asked for
 * in a week — and it is the one thing in this system stored at up to 10 MB a piece.
 */
const IMAGE_RETENTION_DAYS = 7;

/** Bounded per pass, like everything else here; the drainer runs every five minutes. */
const IMAGE_PURGE_BATCH = 25;

/**
 * Spotify re-imports per pass.
 *
 * Small on purpose. Each one is two calls to Spotify plus a write, the interval is a
 * month, and the drainer runs 288 times a day — so even three per pass clears a
 * backlog of hundreds well inside a day without ever looking like a burst.
 */
const SPOTIFY_IMPORT_BATCH = 3;

export type DrainResult = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  released: number;
  eventsPurged: number;
  /** Retained screenshots from failed extractions, deleted from storage. */
  imagesPurged: number;
  /** Spotify connections whose monthly top-artist import ran on this pass. */
  spotifyImported: number;
  runsFinalized: number;
  errors: string[];
};

export async function drainDigestQueue(
  supabase: AdminClient,
  env: AppEnv,
  { batchSize = BATCH_SIZE }: { batchSize?: number } = {},
): Promise<DrainResult> {
  const result: DrainResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    released: 0,
    eventsPurged: 0,
    imagesPurged: 0,
    spotifyImported: 0,
    runsFinalized: 0,
    errors: [],
  };

  // Recover anything a previous invocation claimed and never finished, before
  // taking new work.
  const { data: released } = await supabase.rpc("release_stale_digest_jobs", {
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (typeof released === "number") result.released = released;

  const { data: claimedRows, error: claimError } = await supabase.rpc(
    "claim_digest_jobs",
    { p_limit: batchSize, p_lease_seconds: LEASE_SECONDS },
  );

  if (claimError) {
    result.errors.push(`Claiming jobs failed: ${claimError.message}`);
    return result;
  }

  const jobs = (claimedRows ?? []) as DigestJob[];
  result.claimed = jobs.length;

  const runWindows = new Map<string, { start: string; end: string }>();

  for (const job of jobs) {
    try {
      let window = runWindows.get(job.run_id);
      if (!window) {
        const { data: run } = await supabase
          .from("digest_runs")
          .select("window_start, window_end")
          .eq("id", job.run_id)
          .maybeSingle<Pick<DigestRun, "window_start" | "window_end">>();
        if (!run) throw new Error("The run this job belongs to no longer exists.");
        window = { start: run.window_start, end: run.window_end };
        runWindows.set(job.run_id, window);
      }

      const digest = await buildDigest(supabase, env, job.user_id, {
        startDate: window.start,
        endDate: window.end,
      });

      if (!digest) {
        await markSkipped(supabase, job.id, "The subscriber no longer exists.");
        result.skipped += 1;
        continue;
      }

      // An empty digest is still worth sending — it tells the reader the week is
      // quiet and gives them a link to widen their filters, which is more useful
      // than silence that looks like a broken service. But if they follow nothing
      // at all there is genuinely nothing to say.
      if (digest.cities.length === 0) {
        await markSkipped(
          supabase,
          job.id,
          "No cities followed, so there was nothing to send.",
        );
        result.skipped += 1;
        continue;
      }

      const { emailId } = await sendDigestEmail(env, digest);

      await supabase
        .from("digest_jobs")
        .update({
          status: "sent",
          email_id: emailId,
          event_count: digest.totalEventCount,
          locked_until: null,
          sent_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", job.id);

      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const giveUp = job.attempts >= MAX_ATTEMPTS;

      await supabase
        .from("digest_jobs")
        .update({
          // Below the attempt limit the job goes back on the queue and the next
          // pass retries it; at the limit it stops so one bad address cannot spin
          // forever.
          status: giveUp ? "failed" : "queued",
          error: message,
          locked_until: null,
        })
        .eq("id", job.id);

      if (giveUp) result.failed += 1;
      result.errors.push(`job ${job.id}: ${message}`);
    }
  }

  // Housekeeping, on every pass rather than only after a send: Ticketmaster's
  // terms require cached event content to be short-lived.
  const { data: purged } = await supabase.rpc("purge_expired_events");
  if (typeof purged === "number") result.eventsPurged = purged;

  // Unconfirmed anonymous signups are swept on the same pass rather than getting
  // a cron trigger of their own — they are a waiting room, not a queue.
  await supabase.rpc("purge_expired_pending_subscriptions");

  // Retention. Rides along here rather than on its own trigger for the same reason:
  // this handler already runs every five minutes, and the work is a few bounded
  // deletes. Errors are collected rather than thrown — housekeeping must never be
  // the reason an email did not go out.
  const { error: retentionError } = await supabase.rpc("purge_stale_data");
  if (retentionError) {
    result.errors.push(`retention purge: ${retentionError.message}`);
  }

  result.imagesPurged = await purgeFailedFeedImages(supabase, result.errors);
  result.spotifyImported = await refreshSpotifyLinks(supabase, env, result.errors);

  for (const runId of new Set(jobs.map((job) => job.run_id))) {
    const { data: finalized } = await supabase.rpc("finalize_digest_run", {
      p_run_id: runId,
    });
    if (finalized === true) result.runsFinalized += 1;
  }

  return result;
}

/**
 * Deletes the screenshots kept for failed extractions, once they are a week old.
 *
 * Separate from purge_stale_data because Postgres cannot delete a storage object —
 * only the app, through the storage API, can.
 *
 * Why these exist at all: api/feeds/route.ts writes the image to the private bucket
 * *only* when extraction fails, so a retry would not make somebody find the
 * screenshot again. But there is no retry entry point in the UI yet, and the only
 * deletions happen when a reader manually discards a feed or deletes their account.
 * So in practice every failed upload keeps its image forever, at up to 10 MB each —
 * a hundred ignored failures is half the free storage tier.
 *
 * Order matters: the object goes first, then image_path is cleared. Doing it the
 * other way round would lose the only pointer to the file and orphan it permanently.
 */
async function purgeFailedFeedImages(
  supabase: AdminClient,
  errors: string[],
): Promise<number> {
  const cutoff = new Date(
    Date.now() - IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: stale, error } = await supabase
    .from("feeds")
    .select("id, image_path")
    .eq("status", "failed")
    .not("image_path", "is", null)
    .lt("created_at", cutoff)
    .limit(IMAGE_PURGE_BATCH);

  if (error) {
    errors.push(`stale image lookup: ${error.message}`);
    return 0;
  }

  const rows = (stale ?? []) as { id: string; image_path: string }[];
  if (rows.length === 0) return 0;

  const { error: removeError } = await supabase.storage
    .from("feeds")
    .remove(rows.map((row) => row.image_path));

  if (removeError) {
    errors.push(`stale image removal: ${removeError.message}`);
    return 0;
  }

  const { error: clearError } = await supabase
    .from("feeds")
    .update({ image_path: null })
    .in(
      "id",
      rows.map((row) => row.id),
    );

  if (clearError) {
    // The files are gone but the paths remain, so the next pass will try again and
    // storage.remove is idempotent. Worth reporting, not worth failing over.
    errors.push(`stale image path clear: ${clearError.message}`);
  }

  return rows.length;
}

/**
 * Re-imports top artists for the Spotify connections that are due.
 *
 * Here rather than on its own cron trigger because the interval is a month and this
 * handler already runs every five minutes — a dedicated trigger would be a second
 * moving part to keep alive for work that is never urgent.
 *
 * A dead grant is recorded, not retried. Somebody who revoked access in Spotify's own
 * settings will never succeed again, and a job that keeps asking would spend calls
 * forever and bury the real errors.
 */
async function refreshSpotifyLinks(
  supabase: AdminClient,
  env: AppEnv,
  errors: string[],
): Promise<number> {
  if (!env.spotifyClientId || !env.spotifyClientSecret) return 0;

  let due: string[];
  try {
    due = await findDueImports(supabase, SPOTIFY_IMPORT_BATCH);
  } catch (error) {
    errors.push(`spotify due lookup: ${describeError(error)}`);
    return 0;
  }

  let imported = 0;
  for (const userId of due) {
    try {
      const outcome = await importTopArtists(supabase, env, userId);

      if (outcome.status === "imported") {
        imported += 1;
      } else if (outcome.status === "needs_reconnect") {
        await markNeedsReconnect(supabase, userId, outcome.reason);
        errors.push(`spotify ${userId}: reconnect needed`);
      } else if (outcome.status === "error") {
        // Left due, so the next pass retries. Transient by assumption — a rate limit
        // or a bad minute at Spotify — which is exactly what should be retried.
        errors.push(`spotify ${userId}: ${outcome.reason}`);
      }
    } catch (error) {
      errors.push(`spotify ${userId}: ${describeError(error)}`);
    }
  }

  return imported;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markSkipped(
  supabase: AdminClient,
  jobId: number,
  reason: string,
): Promise<void> {
  await supabase
    .from("digest_jobs")
    .update({ status: "skipped", error: reason, locked_until: null })
    .eq("id", jobId);
}
