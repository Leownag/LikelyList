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
 */

export type SendResult = { emailId: string | null; bytes: number };

export async function sendDigestEmail(
  env: AppEnv,
  digest: Digest,
  { to }: { to?: string } = {},
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

  const { data, error } = await resend.emails.send({
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
  });

  if (error) {
    throw new Error(`Resend rejected the message: ${error.message}`);
  }

  return { emailId: data?.id ?? null, bytes: rendered.bytes };
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
