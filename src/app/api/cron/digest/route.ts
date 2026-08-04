import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { planWeeklyDigest } from "@/lib/digest/plan";
import { drainDigestQueue } from "@/lib/digest/drain";
import { describeSenderReadiness } from "@/lib/digest/send";

/**
 * The one entry point for both scheduled passes.
 *
 * `worker.ts` reaches this by calling the generated Next fetch handler directly
 * rather than importing the pipeline itself. That keeps a single implementation
 * for the cron path and the manual path, and avoids bundling the app twice.
 *
 * Guarded by a shared secret because it is a public route that sends email.
 */
export async function POST(request: NextRequest) {
  const env = readEnv();

  if (!env.cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so the cron endpoint is disabled." },
      { status: 503 },
    );
  }

  const presented =
    request.headers.get("x-cron-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    "";

  if (!timingSafeEqual(presented, env.cronSecret)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") ?? "drain";

  // Checked before constructing the client, which throws. Without this the
  // commonest setup mistake surfaces as an unhandled 500 with a stack trace
  // instead of a sentence telling you which variable is missing.
  if (!env.supabaseServiceRoleKey) {
    return NextResponse.json(
      {
        mode,
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not set. The digest pipeline reads the shared event cache and sends on behalf of users who have no session, so it needs the service role key.",
      },
      { status: 503 },
    );
  }

  const supabase = createAdminClient(env);
  const senderWarning = describeSenderReadiness(env);

  try {
    if (mode === "weekly") {
      const plan = await planWeeklyDigest(supabase, env);
      // Drain immediately too: subscribers whose local morning has already
      // passed when the run is built (zones ahead of UTC) should not wait five
      // minutes for the next pass.
      const drain = await drainDigestQueue(supabase, env);
      return NextResponse.json({ mode, plan, drain, senderWarning });
    }

    const drain = await drainDigestQueue(supabase, env);
    return NextResponse.json({ mode: "drain", drain, senderWarning });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ mode, error: message }, { status: 500 });
  }
}

/**
 * Length-independent comparison.
 *
 * A plain `===` on a secret leaks its length and prefix through timing. This
 * compares every byte of a fixed-width buffer regardless of input.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  let mismatch = left.length === right.length ? 0 : 1;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}
