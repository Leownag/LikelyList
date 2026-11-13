import { Resend } from "resend";
import type { AppEnv } from "@/lib/env";
import { requireKey } from "@/lib/env";
import type { Digest } from "./types";
import { renderWithinSizeBudget } from "@/lib/email/render";

/**
 * Sending, and the unsubscribe headers that make it deliverable.
 *
 * Since mid-2024 Google and Yahoo require one-click unsubscribe from bulk
 * senders, and it is a strong reputation signal well below their stated
 * threshold. Two details are easy to get wrong and both are load-bearing:
 *
 *  - BOTH the https and the mailto form must be listed. Gmail will take either,
 *    but Outlook and iOS Mail honour only `mailto:`, so omitting it loses the
 *    native unsubscribe button for those clients entirely.
 *  - The https endpoint must accept POST and unsubscribe without a confirmation
 *    page (RFC 8058). See app/unsubscribe/route.ts.
 *
 * Sending is also the one step in the pipeline that cannot be undone or retried
 * safely on its own, so it carries an idempotency key. See `digestIdempotencyKey`.
 */

export type SendResult = {
  emailId: string | null;
  bytes: number;
  /**
   * True when this exact send had already been accepted under the same key, so
   * nothing new was delivered. The reader has the email; this attempt is a no-op.
   */
  deduped: boolean;
};

/**
 * The key that makes a resend of the same job a no-op instead of a second email.
 *
 * `(run_id, user_id)` is already the unique constraint on digest_jobs, so it is
 * exactly the identity of "this subscriber's email for this week" — stable across
 * every retry of a job, distinct for every other send. Well inside Resend's 256
 * character ceiling at two UUIDs and a colon.
 *
 * What this buys: the window between Resend accepting a message and the status
 * write landing in Postgres. A Worker killed in there leaves the job in `sending`
 * until its lease expires, and the next drainer pass retries a send that already
 * happened. Presenting the same key makes Resend return the original send rather
 * than post a duplicate.
 *
 * Resend holds a key for 24 hours, which comfortably covers three attempts five
 * minutes apart.
 */
export function digestIdempotencyKey(runId: string, userId: string): string {
  return `digest:${runId}:${userId}`;
}

export async function sendDigestEmail(
  env: AppEnv,
  digest: Digest,
  { to, idempotencyKey }: { to?: string; idempotencyKey?: string } = {},
): Promise<SendResult> {
  const resend = new Resend(
    requireKey(env.resendApiKey, "RESEND_API_KEY", "sending the digest"),
  );

  const rendered = await renderWithinSizeBudget(digest);

  const unsubscribeForms = [`<${digest.unsubscribeUrl}>`];
  if (digest.unsubscribeMailto) {
    unsubscribeForms.push(
      `<mailto:${digest.unsubscribeMailto}?subject=unsubscribe%20${digest.userId}>`,
    );
  }

  const { data, error } = await resend.emails.send(
    {
      from: requireKey(env.emailFrom, "EMAIL_FROM", "sending the digest"),
      to: to ?? digest.email,
      subject: rendered.subject,
      html: rendered.html,
      // A text part is what several clients and most accessibility tooling
      // actually surface, and its absence is itself a spam signal.
      text: rendered.text,
      headers: {
        "List-Unsubscribe": unsubscribeForms.join(", "),
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    { idempotencyKey },
  );

  if (error) {
    // Resend holds this key against an earlier request whose body differed, which
    // means that earlier request is the one that reached the reader. The key is
    // spent, so retrying cannot succeed, and re-sending under a fresh key would
    // post the duplicate this key exists to prevent. Report it as delivered.
    //
    // With a deterministic payload (see digestLinkIssuedAt) a retry normally
    // matches byte for byte and Resend simply replays the original response, so
    // this branch is the fallback for content that genuinely moved underneath us —
    // an event dropping out of the cache between attempts, say.
    if (error.name === "invalid_idempotent_request") {
      return { emailId: null, bytes: rendered.bytes, deduped: true };
    }

    // `concurrent_idempotent_requests` deliberately falls through to the throw:
    // a sibling request holding the same key is still in flight, so this attempt
    // must not send, and Resend cannot yet replay the original response either.
    // Failing returns the job to the queue, and the next pass gets the replay.
    throw new Error(`Resend rejected the message: ${error.message}`);
  }

  return { emailId: data?.id ?? null, bytes: rendered.bytes, deduped: false };
}

/**
 * Whether the sender looks usable.
 *
 * Worth checking before a run rather than discovering it 200 jobs in. Whether the
 * domain in EMAIL_FROM is actually verified cannot be read from here — a
 * sending-only Resend key may not list domains — so that check lives in
 * scripts/preflight.ts, which can be run with a full-access key.
 */
export function describeSenderReadiness(env: AppEnv): string | null {
  if (!env.resendApiKey) return "RESEND_API_KEY is not set.";
  if (!env.emailFrom) return "EMAIL_FROM is not set.";
  if (!env.emailUnsubscribeMailto) {
    return "EMAIL_UNSUBSCRIBE_MAILTO is not set, so the mailto: form of List-Unsubscribe is missing — Outlook and iOS Mail will not show a native unsubscribe button.";
  }
  return null;
}
