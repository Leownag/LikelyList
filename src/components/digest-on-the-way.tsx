"use client";

import Link from "next/link";
import { Button, Notice } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import { DigestSummaryPanel, useDigestBuild } from "@/components/digest-build";
import { useT } from "@/lib/i18n/client";
import { SLOT, interleave } from "@/lib/i18n/interleave";

/**
 * What the landing page says to somebody who is already subscribed.
 *
 * Every logo in the digest email links to `/`, so this is the page a reader lands on
 * most often — and until now it answered with the anonymous subscribe box, asking for
 * an address it already has. The one thing they might actually want here is the digest
 * early, which is why the build button is secondary and the arrival date is the headline.
 */
export function DigestOnTheWay({
  nextSendLabel,
  paused,
  diagnostics = false,
}: {
  nextSendLabel: string;
  paused: boolean;
  /** Operator-facing byte sizes; off unless dev mode is on for this browser. */
  diagnostics?: boolean;
}) {
  const t = useT();
  const { busy, summary, cooldownSeconds, run } = useDigestBuild();

  return (
    <div className="border border-accent/40 bg-surface/60 p-5 backdrop-blur-sm">
      <p className="flex items-start gap-2.5 text-sm text-text">
        <span className="mt-1.5">
          <PixelDot size={6} />
        </span>
        <span>{paused ? t("landing.digest.paused") : t("landing.digest.onTheWay")}</span>
      </p>

      {paused ? (
        <div className="mt-4">
          <Notice tone="warn">
            {interleave(t("landing.digest.resume", { settings: SLOT }), [
              <Link key="s" className="text-accent underline" href="/app/settings">
                {t("nav.settings")}
              </Link>,
            ])}
          </Notice>
        </div>
      ) : (
        <p className="mt-2 pl-[14px] font-mono text-base">
          {t("overview.next.value", { when: nextSendLabel })}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy !== null || cooldownSeconds > 0}
          onClick={() => run(false)}
        >
          {busy === "build" ? t("landing.digest.building") : t("landing.digest.build")}
        </Button>
        {cooldownSeconds > 0 ? (
          <span className="text-xs text-faint">
            {t("landing.digest.cooldown", { seconds: cooldownSeconds })}
          </span>
        ) : null}
      </div>

      {summary && diagnostics ? <DigestSummaryPanel summary={summary} /> : null}
    </div>
  );
}
