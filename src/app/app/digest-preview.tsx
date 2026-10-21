"use client";

import { useState } from "react";
import { Button, StatusLine } from "@/components/ui";
import { DigestSummaryPanel, useDigestBuild } from "@/components/digest-build";

/**
 * Build-now / send-now controls.
 *
 * These exist for setup and verification more than for daily use: "Build it now"
 * reports the rendered byte size against Gmail's clipping threshold, which is the
 * one property of the email that cannot be eyeballed.
 *
 * The two actions are not equivalent and no longer look it. One renders a
 * preview; the other puts a real email in a real inbox, and they were the same
 * size, the same variant and side by side. Sending now takes a second click.
 *
 * `diagnostics` gates the byte-size panel, which is written for whoever is
 * operating this and says things like "10.6 KB · under Gmail's clip limit" and
 * "DELIVERED: not sent". The caller decides, from the dev-mode cookie.
 */
export function DigestPreview({
  diagnostics = false,
  scope,
}: {
  diagnostics?: boolean;
  /** The account, so one reader's cooldown is not another's. */
  scope?: string;
}) {
  const { busy, summary, cooldownSeconds, run } = useDigestBuild({ scope });
  const [confirmingSend, setConfirmingSend] = useState(false);
  const blocked = busy !== null || cooldownSeconds > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={blocked}
          onClick={() => {
            setConfirmingSend(false);
            void run(false);
          }}
        >
          {busy === "build" ? "Building…" : "Build it now"}
        </Button>

        {confirmingSend ? (
          <>
            <Button
              variant="danger"
              disabled={blocked}
              onClick={() => {
                setConfirmingSend(false);
                void run(true);
              }}
            >
              {busy === "send" ? "Sending…" : "Yes, send it now"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingSend(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={blocked}
            onClick={() => setConfirmingSend(true)}
          >
            Email it to me
          </Button>
        )}
      </div>

      <div className="mt-2">
        <StatusLine>
          {confirmingSend
            ? "This sends a real email to your address now, outside the weekly schedule."
            : cooldownSeconds > 0
              ? `Building the digest queries Ticketmaster, so it is limited to once every few minutes. Ready again in ${cooldownSeconds}s.`
              : null}
        </StatusLine>
      </div>

      {summary ? (
        <DigestSummaryPanel summary={summary} diagnostics={diagnostics} />
      ) : null}
    </div>
  );
}
