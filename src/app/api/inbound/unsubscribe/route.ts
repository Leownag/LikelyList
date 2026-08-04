import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqual } from "@/lib/dev-mode";

/**
 * Handles a `mailto:` unsubscribe that arrived as an actual email.
 *
 * `List-Unsubscribe` carries two forms. The `https` one is a POST that
 * /unsubscribe handles directly. The `mailto` one — which Outlook and iOS Mail are
 * the only ones to honour — makes the mail client *send an email*, so something has
 * to read that mailbox. Cloudflare Email Routing forwards it to the Worker's
 * `email()` handler (see worker.ts), which posts the parsed message here.
 *
 * Failing to act on an unsubscribe request is the fastest way to lose a sending
 * domain's reputation, so this exists rather than leaving it to someone reading a
 * forwarded inbox by hand.
 *
 * Two ways to identify the sender, in order of reliability:
 *
 *   1. The subject. Our own header sets `subject=unsubscribe <user-id>`, so a
 *      client that preserves it tells us exactly which account.
 *   2. The From address. Some clients write their own subject, so fall back to
 *      matching the envelope sender against a profile. Weaker — a forwarded
 *      mailbox or an alias will not match — but better than dropping the request.
 */

const BodySchema = z.object({
  subject: z.string().max(500).nullable().default(null),
  from: z.string().max(320).nullable().default(null),
});

const USER_ID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export async function POST(request: NextRequest) {
  const env = readEnv();

  if (!env.cronSecret) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }
  // Same shared secret as the cron path: this is an internal endpoint the Worker
  // calls, never something a browser reaches.
  if (!timingSafeEqual(request.headers.get("x-cron-secret") ?? "", env.cronSecret)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Bad payload." }, { status: 400 });
  }

  const supabase = createAdminClient(env);

  // 1. The user id we put in the subject ourselves.
  const fromSubject = body.subject?.match(USER_ID_PATTERN)?.[0] ?? null;
  if (fromSubject) {
    const { error } = await supabase
      .from("profiles")
      .update({ digest_enabled: false })
      .eq("id", fromSubject);

    if (!error) {
      return NextResponse.json({ ok: true, matchedBy: "subject" });
    }
  }

  // 2. Fall back to the sender's address.
  const address = extractAddress(body.from);
  if (address) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", address)
      .maybeSingle<{ id: string }>();

    if (profile) {
      await supabase
        .from("profiles")
        .update({ digest_enabled: false })
        .eq("id", profile.id);
      return NextResponse.json({ ok: true, matchedBy: "from" });
    }
  }

  // Answered 200 on purpose. The message was accepted and processed as far as it
  // could be; a non-2xx would make the Worker treat a permanently unmatchable
  // email as something to retry. Logged so it can be looked at.
  console.warn(
    `[inbound-unsubscribe] could not match subject=${JSON.stringify(body.subject)} from=${JSON.stringify(body.from)}`,
  );
  return NextResponse.json({ ok: true, matchedBy: "none" });
}

/** Pulls the bare address out of `Name <someone@example.com>`. */
function extractAddress(value: string | null): string | null {
  if (!value) return null;
  const angled = value.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}
