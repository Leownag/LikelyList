import type { AdminClient } from "@/lib/supabase/admin";
import type { AppEnv } from "@/lib/env";
import type { DigestJob, DigestRun } from "@/lib/db";
import { buildDigest } from "./build";
import { sendDigestEmail } from "./send";

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

export type DrainResult = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  released: number;
  eventsPurged: number;
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

  for (const runId of new Set(jobs.map((job) => job.run_id))) {
    const { data: finalized } = await supabase.rpc("finalize_digest_run", {
      p_run_id: runId,
    });
    if (finalized === true) result.runsFinalized += 1;
  }

  return result;
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
