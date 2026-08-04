import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { requestSubscription } from "@/lib/subscribe/anonymous";

const BodySchema = z.object({
  email: z.string().min(3).max(254),
  citySlug: z.string().max(64).nullable().default(null),
  genreIds: z.array(z.number().int()).max(20).default([]),
  timezone: z.string().max(64).default("America/New_York"),
});

/**
 * Anonymous subscribe: step one of two.
 *
 * Records the request and sends a single confirmation email. Nothing is added to
 * the send list here — see lib/subscribe/anonymous.ts.
 *
 * The response is deliberately identical whether the address is new, already
 * registered, or has hit its confirmation cap. Reporting the difference would let
 * anyone use this endpoint to test whether a given address has an account here,
 * and would let them decide how often a stranger's inbox gets poked.
 */
export async function POST(request: NextRequest) {
  const env = readEnv();

  if (!env.supabaseServiceRoleKey || !env.resendApiKey) {
    return NextResponse.json(
      {
        error:
          "Subscribing is not configured on this server yet (needs SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY).",
      },
      { status: 503 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Send an email address." },
      { status: 400 },
    );
  }

  const outcome = await requestSubscription(env, body);

  // Only genuinely invalid input and real rate limiting are distinguishable; the
  // rest collapse into one indistinguishable success.
  if (outcome.status === "invalid") {
    return NextResponse.json({ error: outcome.reason }, { status: 400 });
  }
  if (outcome.status === "rate_limited") {
    return NextResponse.json({ error: outcome.reason }, { status: 429 });
  }

  return NextResponse.json({
    ok: true,
    message:
      "Check your inbox. If that address isn't already subscribed, there's a confirmation link waiting — nothing is sent until you click it.",
  });
}
