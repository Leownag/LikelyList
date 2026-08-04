"use client";

import { useState } from "react";
import { Button, Notice } from "@/components/ui";

type Summary = {
  sent?: boolean;
  error?: string;
  window?: string;
  cities?: string[];
  eventCount?: number;
  subject?: string;
  bytes?: number;
  withinGmailLimit?: boolean;
  previewUrl?: string;
  senderWarning?: string | null;
};

/**
 * Build-now / send-now controls.
 *
 * These exist for setup and verification more than for daily use: "Build it now"
 * reports the rendered byte size against Gmail's clipping threshold, which is the
 * one property of the email that cannot be eyeballed.
 */
export function DigestPreview() {
  const [busy, setBusy] = useState<"build" | "send" | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function run(send: boolean) {
    setBusy(send ? "send" : "build");
    setSummary(null);
    try {
      const response = await fetch(`/api/digest/preview${send ? "?send=1" : ""}`, {
        method: "POST",
      });
      setSummary((await response.json()) as Summary);
    } catch (error) {
      setSummary({
        error: error instanceof Error ? error.message : "Request failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy !== null} onClick={() => run(false)}>
          {busy === "build" ? "Building…" : "Build it now"}
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => run(true)}>
          {busy === "send" ? "Sending…" : "Email it to me"}
        </Button>
      </div>

      {summary ? (
        <div className="mt-4 space-y-3">
          {summary.error ? <Notice tone="error">{summary.error}</Notice> : null}
          {summary.senderWarning ? (
            <Notice tone="warn">{summary.senderWarning}</Notice>
          ) : null}

          {summary.subject ? (
            <div className="border border-border bg-surface-raised p-4 text-sm">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Row label="subject" value={summary.subject} />
                <Row label="window" value={summary.window ?? "—"} />
                <Row
                  label="matches"
                  value={`${summary.eventCount ?? 0} show(s)`}
                />
                <Row
                  label="cities"
                  value={summary.cities?.join(", ") || "none followed"}
                />
                <Row
                  label="email size"
                  value={`${((summary.bytes ?? 0) / 1024).toFixed(1)} KB${
                    summary.withinGmailLimit
                      ? " · under Gmail's clip limit"
                      : " · OVER Gmail's clip limit"
                  }`}
                  tone={summary.withinGmailLimit ? "ok" : "bad"}
                />
                <Row
                  label="delivered"
                  value={summary.sent ? "yes, check your inbox" : "not sent"}
                />
              </dl>

              {summary.previewUrl ? (
                <a
                  className="mt-4 inline-block text-xs text-accent underline"
                  href={summary.previewUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open the web version
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "bad";
}) {
  return (
    <div>
      <dt className="label-pixel">{label}</dt>
      <dd
        className={
          tone === "bad" ? "text-danger" : tone === "ok" ? "text-accent" : "text-text"
        }
      >
        {value}
      </dd>
    </div>
  );
}
