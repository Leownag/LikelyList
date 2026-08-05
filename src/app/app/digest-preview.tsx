"use client";

import { Button } from "@/components/ui";
import { DigestSummaryPanel, useDigestBuild } from "@/components/digest-build";

/**
 * Build-now / send-now controls.
 *
 * These exist for setup and verification more than for daily use: "Build it now"
 * reports the rendered byte size against Gmail's clipping threshold, which is the
 * one property of the email that cannot be eyeballed.
 */
export function DigestPreview() {
  const { busy, summary, cooldownSeconds, run } = useDigestBuild();
  const blocked = busy !== null || cooldownSeconds > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={blocked} onClick={() => run(false)}>
          {busy === "build" ? "Building…" : "Build it now"}
        </Button>
        <Button variant="outline" disabled={blocked} onClick={() => run(true)}>
          {busy === "send" ? "Sending…" : "Email it to me"}
        </Button>
        {cooldownSeconds > 0 ? (
          <span className="text-xs text-faint">ready again in {cooldownSeconds}s</span>
        ) : null}
      </div>

      {summary ? <DigestSummaryPanel summary={summary} /> : null}
    </div>
  );
}
