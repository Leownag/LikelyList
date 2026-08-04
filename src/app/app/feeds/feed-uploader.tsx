"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice } from "@/components/ui";
import { PixelMosaic } from "@/components/pixel";
import {
  ACCEPTED_TYPES,
  imageFromClipboard,
  prepareImage,
  type PreparedImage,
} from "@/lib/vision/preprocess";
import type { FeedExtraction } from "@/lib/db";
import { ConfirmForm } from "./confirm-form";

type Stage =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "reading"; preview: string }
  | { kind: "confirm"; feedId: string; extraction: FeedExtraction; preview: string }
  | { kind: "done"; summary: string };

export function FeedUploader() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleBlob(blob: Blob) {
    setError(null);
    setStage({ kind: "preparing" });

    let prepared: PreparedImage;
    try {
      prepared = await prepareImage(blob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that image.");
      setStage({ kind: "idle" });
      return;
    }

    setStage({ kind: "reading", preview: prepared.previewUrl });

    const response = await fetch("/api/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl: prepared.dataUrl }),
    });

    const payload = (await response.json()) as {
      id?: string;
      extracted?: FeedExtraction;
      error?: string;
    };

    if (!response.ok || !payload.extracted || !payload.id) {
      setError(payload.error ?? "Reading that image failed.");
      setStage({ kind: "idle" });
      router.refresh();
      return;
    }

    setStage({
      kind: "confirm",
      feedId: payload.id,
      extraction: payload.extracted,
      preview: prepared.previewUrl,
    });
  }

  return (
    <div
      // Paste anywhere on this panel. Listening on a focusable container rather
      // than on window keeps the handler from stealing pastes meant for the
      // search and name inputs elsewhere on the page.
      onPaste={(event) => {
        const file = imageFromClipboard(event.clipboardData.items);
        if (file) {
          event.preventDefault();
          void handleBlob(file);
        }
      }}
      tabIndex={-1}
    >
      {stage.kind === "confirm" ? (
        <ConfirmForm
          feedId={stage.feedId}
          extraction={stage.extraction}
          previewUrl={stage.preview}
          onApplied={(summary) => {
            setStage({ kind: "done", summary });
            router.refresh();
          }}
          onDiscard={() => {
            void fetch(`/api/feeds/${stage.feedId}`, { method: "DELETE" });
            setStage({ kind: "idle" });
            router.refresh();
          }}
        />
      ) : (
        <Card
          className={`p-8 text-center transition-colors ${
            dragging ? "border-accent" : ""
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void handleBlob(file);
          }}
        >
          <div className="flex justify-center">
            <PixelMosaic
              seed={stage.kind}
              cols={7}
              rows={4}
              cell={8}
              density={stage.kind === "reading" ? 0.55 : 0.28}
            />
          </div>

          {stage.kind === "reading" || stage.kind === "preparing" ? (
            <p className="mt-5 text-sm text-muted">
              {stage.kind === "preparing"
                ? "Preparing the image…"
                : "Reading the flyer…"}
            </p>
          ) : (
            <>
              <p className="mt-5 text-sm">
                Paste a screenshot, drop an image, or{" "}
                <button
                  type="button"
                  className="text-accent underline"
                  onClick={() => fileInput.current?.click()}
                >
                  choose a file
                </button>
                .
              </p>
              <p className="mt-2 text-xs text-faint">
                Show posters, Instagram stories, Spotify screenshots. The image
                is read once and not kept.
              </p>
            </>
          )}

          {stage.kind === "done" ? (
            <div className="mt-5 text-left">
              <Notice>{stage.summary}</Notice>
              <div className="mt-3">
                <Button variant="outline" onClick={() => setStage({ kind: "idle" })}>
                  Add another
                </Button>
              </div>
            </div>
          ) : null}

          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleBlob(file);
              event.target.value = "";
            }}
          />
        </Card>
      )}

      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </div>
  );
}
