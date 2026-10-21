/**
 * Does a subscriber in each timezone get their email at their own morning?
 *
 *   npm run schedule:check
 *
 * The arithmetic is unit-tested in scripts/cron.test.ts and src/lib/time.test.ts.
 * What those cannot reach is the part that decides when mail actually goes out:
 * a timezone stored in Postgres, read back by the planner, turned into a
 * `send_after`, and held by the drainer's claim predicate until that instant.
 * Every piece of that is covered somewhere; the join between them was not.
 *
 * Three parts:
 *
 *   1. The release order for a real week, printed. One line per zone, so a
 *      human can see that New York goes out hours before Honolulu and that
 *      nothing lands before the run that builds it.
 *   2. Round trip. A throwaway account per zone, written through the same
 *      column the app writes, read back through the same shape the planner
 *      reads, and run through the planner's own safeSendInstant. Asserted to be
 *      that reader's local Wednesday at their chosen hour.
 *   3. The gate. A job due in the future is not claimable.
 *
 * Deliberately does NOT call planWeeklyDigest. That enqueues for every enabled
 * subscriber and opens a run row, which is a real side effect on a shared
 * database. And it never inserts a job that is already due: claim_digest_jobs
 * scans the whole table, so a due row would be picked up and sent for real by
 * the next production drain pass.
 */
import { createClient } from "@supabase/supabase-js";
import { safeSendInstant } from "../src/lib/digest/plan";
import {
  DIGEST_SEND_HOURS,
  DIGEST_WEEKDAY,
  TIMEZONES,
  digestRunDate,
  localParts,
} from "../src/lib/time";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Mirrors CACHE_TTL_HOURS in lib/digest/plan.ts. */
const CACHE_TTL_HOURS = 36;

const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, fn: () => string | void) {
  try {
    const detail = fn() ?? "";
    results.push({ name, ok: true, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    results.push({ name, ok: false, detail });
    console.log(`✗ ${name}\n    ${detail}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The instant the builder fires for the week containing `from`. */
function nextRunStart(from: Date): Date {
  const [hour, minute] = [8, 0]; // "0 8 * * 3", asserted against worker.ts in cron.test.ts
  const date = digestRunDate(from);
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hour,
      minute,
    ),
  );
}

function inZone(at: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

async function main() {
  const runStart = nextRunStart(new Date());
  console.log(`schedule check\nbuilder fires ${runStart.toISOString()}\n`);

  // ---- 1. what the week looks like ----------------------------------------

  console.log("release order, at the default send hour:");
  const rows = TIMEZONES.map((zone) => {
    const at = safeSendInstant(runStart, { id: zone, timezone: zone, digest_send_hour: 8 }, []);
    return { zone, at: new Date(at) };
  }).sort((a, b) => a.at.getTime() - b.at.getTime());

  for (const row of rows) {
    const hoursAfter = (row.at.getTime() - runStart.getTime()) / 3_600_000;
    console.log(
      `  ${row.zone.padEnd(20)} ${row.at.toISOString()}  (+${hoursAfter.toFixed(0)}h)  ${inZone(row.at, row.zone)}`,
    );
  }
  console.log();

  check("every zone is released after the run is built", () => {
    for (const row of rows) {
      assert(
        row.at.getTime() >= runStart.getTime(),
        `${row.zone} is due ${row.at.toISOString()}, before the build`,
      );
    }
    return `earliest ${rows[0].zone}, latest ${rows[rows.length - 1].zone}`;
  });

  check("the last send is still inside the event cache's life", () => {
    const last = rows[rows.length - 1];
    const hours = (last.at.getTime() - runStart.getTime()) / 3_600_000;
    assert(
      hours < CACHE_TTL_HOURS,
      `${last.zone} sends ${hours.toFixed(1)}h after the build, past the ${CACHE_TTL_HOURS}h TTL`,
    );
    return `${hours.toFixed(0)}h of ${CACHE_TTL_HOURS}h used`;
  });

  // ---- 2. the round trip through Postgres ---------------------------------

  const made: string[] = [];
  try {
    const expectations: { id: string; zone: string; hour: number }[] = [];

    for (const zone of TIMEZONES) {
      for (const hour of [DIGEST_SEND_HOURS[0], DIGEST_SEND_HOURS[DIGEST_SEND_HOURS.length - 1]]) {
        const email = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@likelylist.test`;
        const { data, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`could not create ${zone}: ${error?.message}`);
        made.push(data.user.id);

        const { error: updateError } = await admin
          .from("profiles")
          .update({ timezone: zone, digest_send_hour: hour })
          .eq("id", data.user.id);
        if (updateError) throw new Error(`could not set ${zone}: ${updateError.message}`);

        expectations.push({ id: data.user.id, zone, hour });
      }
    }

    console.log(
      `  ${expectations.length} throwaway accounts across ${TIMEZONES.length} zones\n`,
    );

    // Read them back exactly as the planner does.
    const { data: subscriberRows, error: readError } = await admin
      .from("profiles")
      .select("id, email, timezone, digest_send_hour")
      .in("id", made);
    if (readError) throw new Error(`could not read profiles: ${readError.message}`);

    check("every subscriber is scheduled for their own local morning", () => {
      const byId = new Map(expectations.map((e) => [e.id, e]));
      let checked = 0;

      for (const row of (subscriberRows ?? []) as {
        id: string;
        timezone: string;
        digest_send_hour: number;
      }[]) {
        const expected = byId.get(row.id)!;
        assert(
          row.timezone === expected.zone,
          `${expected.zone} came back as ${row.timezone}`,
        );
        assert(
          row.digest_send_hour === expected.hour,
          `${expected.zone} hour came back as ${row.digest_send_hour}`,
        );

        const warnings: string[] = [];
        const at = new Date(safeSendInstant(runStart, row, warnings));
        assert(warnings.length === 0, `${expected.zone}: ${warnings[0]}`);

        const local = localParts(row.timezone, at);
        assert(
          local.weekday === DIGEST_WEEKDAY,
          `${expected.zone} @${expected.hour} lands on weekday ${local.weekday}, not ${DIGEST_WEEKDAY}`,
        );
        assert(
          local.hour === expected.hour,
          `${expected.zone} @${expected.hour} lands at ${local.hour} local`,
        );
        assert(
          at.getTime() >= runStart.getTime(),
          `${expected.zone} @${expected.hour} is due before the build`,
        );
        checked += 1;
      }

      assert(checked === expectations.length, `only ${checked} of ${expectations.length} read back`);
      return `${checked} accounts, each on its own Wednesday morning`;
    });

    // ---- 3. the gate -------------------------------------------------------

    const { data: run, error: runError } = await admin
      .from("digest_runs")
      .insert({
        // Far enough out that it cannot collide with a real run's unique run_date.
        run_date: "2099-01-07",
        status: "queued",
        window_start: "2099-01-07",
        window_end: "2099-01-13",
      })
      .select("id")
      .single<{ id: string }>();
    if (runError || !run) throw new Error(`could not open a test run: ${runError?.message}`);

    try {
      const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
      const { error: jobError } = await admin.from("digest_jobs").insert(
        made.slice(0, 3).map((userId) => ({
          run_id: run.id,
          user_id: userId,
          status: "queued" as const,
          // A year out, never already due. claim_digest_jobs scans the whole
          // table, so a due row here would be sent for real by the next
          // production drain pass.
          send_after: future,
        })),
      );
      if (jobError) throw new Error(`could not queue test jobs: ${jobError.message}`);

      const { data: claimed, error: claimError } = await admin.rpc("claim_digest_jobs", {
        p_limit: 50,
        p_lease_seconds: 5,
      });
      if (claimError) throw new Error(`claim failed: ${claimError.message}`);

      check("the drainer holds a job until its own morning", () => {
        const ours = new Set(made);
        const takenEarly = ((claimed ?? []) as { user_id: string }[]).filter((job) =>
          ours.has(job.user_id),
        );
        assert(
          takenEarly.length === 0,
          `${takenEarly.length} jobs were claimed a year before they were due`,
        );
        return "nothing claimed early";
      });
    } finally {
      await admin.from("digest_runs").delete().eq("id", run.id);
    }
  } finally {
    for (const id of made) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log(`\ncleaned up ${made.length} throwaway accounts`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed · ${failed.length} failed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
