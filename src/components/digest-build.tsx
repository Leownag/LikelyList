"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/ui";

/** What POST /api/digest/preview returns, in either mode. */
export type DigestSummary = {
  sent?: boolean;
  error?: string;
  /** Set on a 429 from the build cooldown: seconds until the next attempt is allowed. */
  retryAfterSeconds?: number;
  window?: string;
  cities?: string[];
  eventCount?: number;
  subject?: string;
  bytes?: number;
  withinGmailLimit?: boolean;
  previewUrl?: string;
  senderWarning?: string | null;
};

/** Mirrors COOLDOWN_MS in api/digest/preview — the server is what actually enforces it. */
const COOLDOWN_MS = 180_000;

/**
 * Survives a reload, because the server-side cooldown does: a button that comes back
 * enabled after F5 only to be met with a 429 is worse than one that keeps counting.
 */
const READY_AT_KEY = "likelylist:digest-ready-at";

function secondsLeft(): number {
  if (typeof window === "undefined") return 0;
  const readyAt = Number(window.localStorage.getItem(READY_AT_KEY));
  if (!Number.isFinite(readyAt)) return 0;
  return Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
}

/**
 * Build (and optionally send) this week's digest, with the cooldown the API enforces.
 *
 * Shared by the overview page's build/send pair and the landing page's single button
 * because they hit the same route and therefore share one cooldown — two independent
 * timers would each let the other's window through.
 */
export function useDigestBuild() {
  const [busy, setBusy] = useState<"build" | "send" | null>(null);
  const [summary, setSummary] = useState<DigestSummary | null>(null);
  // Zero on the server and on the first client render, so the two agree; the deadline
  // is picked up on the tick immediately after mount. Reading localStorage during
  // render instead would make the hydrated markup differ from the HTML.
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    const tick = () => setCooldownSeconds(secondsLeft());
    // A 1/s no-op while idle, which is cheaper than the alternative: an interval that
    // only starts when the countdown does cannot show one that was already running
    // when the page loaded.
    const immediate = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, []);

  const run = useCallback(async (send: boolean) => {
    setBusy(send ? "send" : "build");
    setSummary(null);
    try {
      const response = await fetch(`/api/digest/preview${send ? "?send=1" : ""}`, {
        method: "POST",
      });
      const payload = (await response.json()) as DigestSummary;
      setSummary(payload);

      // The server's own remaining time when it refused, ours when it accepted. Trusting
      // the server's number keeps the two clocks from drifting apart across a boundary.
      const until =
        Date.now() +
        (payload.retryAfterSeconds ? payload.retryAfterSeconds * 1000 : COOLDOWN_MS);
      window.localStorage.setItem(READY_AT_KEY, String(until));
      setCooldownSeconds(secondsLeft());
    } catch (error) {
      setSummary({
        error: error instanceof Error ? error.message : "Request failed.",
      });
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, summary, cooldownSeconds, run };
}

/**
 * What a build actually produced.
 *
 * Deliberately English, like the digest email and the web preview it describes: the
 * values are an English subject line and US city names, so translating the labels
 * around them would make the panel read as half-done rather than translated.
 */
export function DigestSummaryPanel({ summary }: { summary: DigestSummary }) {
  return (
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
            <Row label="matches" value={`${summary.eventCount ?? 0} show(s)`} />
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
