"use client";

import { useState } from "react";
import { Button, Card, Input, Label, Notice, Select } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import type { FeedExtraction } from "@/lib/db";

type Role = "headliner" | "support" | null;

type EditableArtist = {
  key: string;
  name: string;
  role: Role;
  confidence: number | null;
  keep: boolean;
};

/**
 * The confirmation step.
 *
 * This is not optional polish. Flyer reading is never perfectly accurate, and a
 * confirm step is far cheaper than any amount of accuracy engineering — it also
 * means a misread name can never silently reweight someone's digest. Fields the
 * model returned as null are shown as "not printed" rather than as blanks to
 * fill, so the UI does not invite the user to invent what the model refused to.
 */
export function ConfirmForm({
  feedId,
  extraction,
  previewUrl,
  onApplied,
  onDiscard,
}: {
  feedId: string;
  extraction: FeedExtraction;
  previewUrl?: string | null;
  onApplied: (summary: string) => void;
  onDiscard?: () => void;
}) {
  const [artists, setArtists] = useState<EditableArtist[]>(() =>
    extraction.artists.map((artist, index) => ({
      key: `${index}-${artist.name}`,
      name: artist.name,
      role: artist.role,
      confidence: artist.confidence,
      keep: true,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  const kept = artists.filter((artist) => artist.keep && artist.name.trim());

  async function apply() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/feeds/${feedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artists: kept.map((artist) => ({
          name: artist.name.trim(),
          role: artist.role,
        })),
        printedGenres: extraction.genres,
      }),
    });

    const payload = (await response.json()) as {
      error?: string;
      artistsLearned?: number;
      genresAdded?: string[];
      warning?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Could not save that.");
      setBusy(false);
      return;
    }

    const parts = [`Learned ${payload.artistsLearned ?? 0} artist(s)`];
    if (payload.genresAdded?.length) {
      parts.push(`added ${payload.genresAdded.join(", ")}`);
    }
    if (payload.warning) parts.push(payload.warning);
    onApplied(parts.join(" · "));
  }

  if (extraction.not_an_event_poster) {
    return (
      <Card className="p-5">
        <Notice tone="warn">
          That doesn&apos;t look like a show flyer, so nothing was learned from
          it. No preferences were changed.
        </Notice>
        {extraction.raw_text ? (
          <p className="mt-3 font-mono text-xs text-faint">
            Text read: {extraction.raw_text.slice(0, 200)}
          </p>
        ) : null}
        {onDiscard ? (
          <div className="mt-4">
            <Button variant="ghost" onClick={onDiscard}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap gap-6">
        {previewUrl ? (
          // A base64 data URL held in memory; next/image cannot optimise it and
          // would only add a round trip.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="The screenshot you added"
            className="h-40 w-auto border border-border object-contain"
          />
        ) : null}

        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Detail label="Venue" value={extraction.venue} />
          <Detail
            label="City"
            value={
              [extraction.city, extraction.state].filter(Boolean).join(", ") ||
              null
            }
          />
          <Detail label="Date" value={extraction.date} />
          <Detail label="Time" value={extraction.time} />
          <Detail
            label="Printed genres"
            value={extraction.genres.length ? extraction.genres.join(", ") : null}
          />
          <Detail
            label="Confidence"
            value={
              extraction.overall_confidence === null
                ? null
                : `${Math.round(extraction.overall_confidence * 100)}%`
            }
          />
        </dl>
      </div>

      <div className="mt-6">
        <Label>Performers — edit or uncheck anything that&apos;s wrong</Label>
        {artists.length === 0 ? (
          <p className="text-sm text-muted">
            No performer names were legible. Nothing will be learned from this
            one.
          </p>
        ) : (
          <ul className="space-y-2">
            {artists.map((artist, index) => (
              <li key={artist.key} className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={artist.keep}
                  aria-label={`Include ${artist.name}`}
                  onChange={(event) =>
                    setArtists((current) =>
                      current.map((a, i) =>
                        i === index ? { ...a, keep: event.target.checked } : a,
                      ),
                    )
                  }
                  className="accent-accent"
                />
                <Input
                  value={artist.name}
                  onChange={(event) =>
                    setArtists((current) =>
                      current.map((a, i) =>
                        i === index ? { ...a, name: event.target.value } : a,
                      ),
                    )
                  }
                  className="w-56"
                />
                <Select
                  value={artist.role ?? ""}
                  aria-label={`Billing for ${artist.name}`}
                  onChange={(event) =>
                    setArtists((current) =>
                      current.map((a, i) =>
                        i === index
                          ? {
                              ...a,
                              role:
                                event.target.value === ""
                                  ? null
                                  : (event.target.value as Role),
                            }
                          : a,
                      ),
                    )
                  }
                  className="w-40"
                >
                  <option value="">unclear</option>
                  <option value="headliner">headliner</option>
                  <option value="support">support</option>
                </Select>
                {artist.confidence !== null && artist.confidence < 0.6 ? (
                  <span className="flex items-center gap-1.5 text-xs text-pixel-2">
                    <PixelDot size={6} color="var(--pixel-2)" /> low confidence
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {extraction.raw_text ? (
        <div className="mt-5">
          <button
            type="button"
            className="label-pixel underline"
            onClick={() => setShowRawText((v) => !v)}
          >
            {showRawText ? "hide" : "show"} what was read
          </button>
          {showRawText ? (
            <pre className="mt-2 max-h-40 overflow-auto border border-border bg-surface-raised p-3 font-mono text-xs text-muted whitespace-pre-wrap">
              {extraction.raw_text}
            </pre>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={apply} disabled={busy || kept.length === 0}>
          {busy ? "Saving…" : `Learn from ${kept.length} artist(s)`}
        </Button>
        {onDiscard ? (
          <Button variant="ghost" onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="label-pixel">{label}</dt>
      <dd className={value ? "text-text" : "text-faint italic"}>
        {value ?? "not printed"}
      </dd>
    </div>
  );
}
