"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * Dev-only: emails this account's digest to itself, right now.
 *
 * Floats over every /app page and holds no state the pages care about, so it can be
 * removed without touching them. The endpoint it calls sends only to the signed-in
 * address and ignores digest_enabled and the send schedule, which is what makes this
 * usable on a paused or half-configured account.
 */
export function DevSendDigest() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/digest/preview?send=1", { method: "POST" });
      const body = (await response.json()) as {
        sent?: boolean;
        error?: string;
        bytes?: number;
        eventCount?: number;
      };
      setStatus(
        body.sent
          ? `sent · ${body.eventCount ?? 0} show(s) · ${((body.bytes ?? 0) / 1024).toFixed(1)} KB`
          : (body.error ?? `failed (${response.status})`),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[min(24rem,calc(100vw-2rem))] flex-col items-end gap-2">
      {status ? (
        <p
          className="pointer-events-auto border border-border bg-surface-raised px-3 py-2 text-xs text-muted"
          onClick={() => setStatus(null)}
        >
          {status}
        </p>
      ) : null}
      <Button
        variant="outline"
        className="pointer-events-auto bg-surface-raised text-xs"
        disabled={busy}
        onClick={send}
      >
        {busy ? "sending…" : "dev · send digest now"}
      </Button>
    </div>
  );
}
