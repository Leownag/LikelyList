"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import type { FeedExtraction } from "@/lib/db";
import { ConfirmForm } from "./confirm-form";

/**
 * A feed that was read but never confirmed — e.g. the tab was closed mid-flow.
 * Its extraction is still on the row, so it can be picked up later rather than
 * requiring the screenshot again.
 */
export function PendingFeed({
  feedId,
  extraction,
}: {
  feedId: string;
  extraction: FeedExtraction;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  if (summary) return <Notice>{summary}</Notice>;

  if (!open) {
    const names = extraction.artists.map((a) => a.name).slice(0, 3).join(", ");
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-surface px-4 py-3">
        <p className="text-sm text-muted">
          {names || "No performers were legible"}
          {extraction.artists.length > 3
            ? ` and ${extraction.artists.length - 3} more`
            : ""}
        </p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Review
        </Button>
      </div>
    );
  }

  return (
    <ConfirmForm
      feedId={feedId}
      extraction={extraction}
      onApplied={(text) => {
        setSummary(text);
        router.refresh();
      }}
      onDiscard={() => {
        void fetch(`/api/feeds/${feedId}`, { method: "DELETE" });
        setOpen(false);
        router.refresh();
      }}
    />
  );
}
