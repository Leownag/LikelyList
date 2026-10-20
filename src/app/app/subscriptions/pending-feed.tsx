"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import type { FeedExtraction } from "@/lib/db";
import { ConfirmForm } from "./confirm-form";

/**
 * A screenshot that was read but never confirmed — e.g. the tab was closed
 * mid-flow. The extraction is still on the row, so it can be picked up later
 * rather than requiring the screenshot again.
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
  const [error, setError] = useState<string | null>(null);

  if (summary) return <Notice>{summary}</Notice>;

  if (!open) {
    const all = extraction.artists ?? [];
    const names = all.map((a) => a.name).slice(0, 3).join(", ");
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-surface px-4 py-3">
        <p className="text-sm text-muted">
          {names || "No artist names were legible"}
          {all.length > 3 ? ` and ${all.length - 3} more` : ""}
        </p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Review
        </Button>
      </div>
    );
  }

  return (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
    <ConfirmForm
      feedId={feedId}
      extraction={extraction}
      onApplied={(text) => {
        setSummary(text);
        router.refresh();
      }}
      onDiscard={async () => {
        // Awaited, not fired and forgotten. The UI used to reset regardless, so
        // a failed delete left the row sitting in "Waiting for you" with nothing
        // said and no way to tell it apart from a new one.
        try {
          const response = await fetch(`/api/feeds/${feedId}`, { method: "DELETE" });
          if (!response.ok) throw new Error(String(response.status));
          setOpen(false);
        } catch {
          setError("Could not discard that. Try again.");
        }
        router.refresh();
      }}
    />
    </>
  );
}
