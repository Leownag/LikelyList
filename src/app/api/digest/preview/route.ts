import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEnv } from "@/lib/env";
import { buildDigest } from "@/lib/digest/build";
import { sendDigestEmail, describeSenderReadiness } from "@/lib/digest/send";
import { renderWithinSizeBudget } from "@/lib/email/render";
import { digestWindow, localDateString } from "@/lib/time";
import { GMAIL_CLIP_BYTES } from "@/lib/email/render";
import type { Profile } from "@/lib/db";

/**
 * One build every three minutes.
 *
 * Both modes are expensive — a build queries the event cache and renders the whole
 * email, and `?send=1` calls Resend on top — and both are reachable from a plain
 * button, so a bored click is enough to run them back to back.
 *
 * ponytail: a fixed window rather than a rolling one — the counter table is keyed by
 * day, so the window goes in the counter's *name*, the same trick /api/explore uses
 * for its per-visitor hourly cap. Worst case is two builds either side of a boundary.
 * Add `profiles.last_preview_at` if that ever matters.
 */
const COOLDOWN_MS = 180_000;

/**
 * Builds the signed-in user's digest right now.
 *
 * Two modes, because both are useful during setup:
 *   ?send=1  actually emails it to the user's own address
 *   default  returns the rendered size and a summary without sending
 *
 * Uses the service-role client because the digest builder reads the shared event
 * cache, which is not exposed to authenticated sessions. The user id comes from
 * the verified session, never from the request body.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const env = readEnv();

  // Same reason as the cron route: fail with a sentence, not a stack trace.
  if (!env.supabaseServiceRoleKey) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not set, so a digest cannot be built. See .env.example.",
      },
      { status: 503 },
    );
  }

  const supabase = createAdminClient(env);
  const send = request.nextUrl.searchParams.get("send") === "1";

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, email")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "timezone" | "email">>();

  const timezone = profile?.timezone ?? "America/New_York";

  // Increment-then-check, atomic in the RPC, so two clicks in flight at once cannot
  // both read "0 so far". Service-role client on purpose: 0004 revoked bump_usage
  // from `authenticated`.
  const now = Date.now();
  const bucket = Math.floor(now / COOLDOWN_MS);
  const { data: usedThisWindow } = await supabase.rpc("bump_usage", {
    p_user_id: user.id,
    p_kind: `digest_preview:${bucket}`,
    p_day: localDateString(timezone, new Date(now)),
    p_amount: 1,
  });

  if (typeof usedThisWindow === "number" && usedThisWindow > 1) {
    const retryAfterSeconds = Math.ceil(((bucket + 1) * COOLDOWN_MS - now) / 1000);
    return NextResponse.json(
      {
        sent: false,
        error: `You just built one. Try again in ${retryAfterSeconds}s.`,
        retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const window = digestWindow(new Date(now), timezone);

  const digest = await buildDigest(supabase, env, user.id, {
    startDate: window.startDate,
    endDate: window.endDate,
    // Enrichment costs YouTube quota; only spend it when actually sending.
    skipEnrichment: !send,
  });

  if (!digest) {
    return NextResponse.json({ error: "Could not build a digest." }, { status: 500 });
  }

  const rendered = await renderWithinSizeBudget(digest);
  const senderWarning = describeSenderReadiness(env);

  const summary = {
    window: `${window.startDate} … ${window.endDate}`,
    cities: digest.cities,
    eventCount: digest.totalEventCount,
    subject: rendered.subject,
    bytes: rendered.bytes,
    withinGmailLimit: rendered.bytes < GMAIL_CLIP_BYTES,
    previewUrl: digest.previewUrl,
    senderWarning,
  };

  if (!send) return NextResponse.json({ sent: false, ...summary });

  try {
    const { emailId } = await sendDigestEmail(env, digest, {
      // Explicitly the signed-in user's own address — a test send must never be
      // addressable to anyone else.
      to: user.email ?? digest.email,
    });
    return NextResponse.json({ sent: true, emailId, ...summary });
  } catch (error) {
    return NextResponse.json(
      {
        sent: false,
        error: error instanceof Error ? error.message : String(error),
        ...summary,
      },
      { status: 502 },
    );
  }
}
