"use client";

import { useState } from "react";
import { Button, Card, Input, Label, Notice, Select } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import { safeExternalUrl } from "@/lib/enrich/links";
import { describeSourceKind } from "@/lib/vision/schema";
import type { FeedExtraction } from "@/lib/db";

type Prominence = "primary" | "mentioned" | null;

/**
 * Above this many names, only the clearly-featured artists start selected.
 *
 * Kept in step with MAX_ARTISTS_PER_FEED in lib/feeds/apply.ts, which is the hard
 * cap applied server-side — this is only about what is ticked by default.
 */
const DEFAULT_KEEP_LIMIT = 12;

type EditableArtist = {
  key: string;
  name: string;
  prominence: Prominence;
  confidence: number | null;
  keep: boolean;
};

/**
 * The confirmation step.
 *
 * Not optional polish. Reading small UI text off a screenshot is never perfectly
 * accurate, and a confirm step is far cheaper than any amount of accuracy
 * engineering — it also means a misread name can never silently reshape what
 * someone gets recommended. Fields the model returned as null are shown as "not
 * shown" rather than as blanks to fill, so the UI does not invite the user to
 * invent what the model correctly refused to.
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
  /** May be async — the caller awaits the delete before resetting. */
  onDiscard?: () => void | Promise<void>;
}) {
  const [artists, setArtists] = useState<EditableArtist[]>(() => {
    const found = extraction.artists ?? [];
    // A top-artists screen or a long playlist can carry dozens of names.
    // Pre-checking all of them would mean the default action is "learn from 60
    // artists at once", which is both slow and a blunt signal — so only the
    // clearly-featured ones start ticked, and the rest are one click away.
    const autoSelect = found.length <= DEFAULT_KEEP_LIMIT;
    return found.map((artist, index) => ({
      key: `${index}-${artist.name}`,
      name: artist.name,
      prominence: artist.prominence,
      confidence: artist.confidence,
      keep: autoSelect || artist.prominence === "primary",
    }));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  const tracks = extraction.tracks ?? [];
  const isFlyer = extraction.source_kind === "concert_flyer";
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
          prominence: artist.prominence,
        })),
        printedGenres: extraction.genres ?? [],
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

  if (extraction.not_music_related) {
    return (
      <Card className="p-5">
        <Notice tone="warn">
          That image doesn&apos;t look music-related, so nothing was learned from
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
      <p className="label-pixel">
        read as {describeSourceKind(extraction.source_kind ?? null)}
      </p>

      <div className="mt-4 flex flex-wrap gap-6">
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
          <Detail
            label="Genres shown"
            value={extraction.genres?.length ? extraction.genres.join(", ") : null}
          />
          <Detail
            label="Songs read"
            value={tracks.length ? `${tracks.length}` : null}
          />
          <Detail
            label="Legibility"
            value={
              extraction.overall_confidence === null ||
              extraction.overall_confidence === undefined
                ? null
                : `${Math.round(extraction.overall_confidence * 100)}%`
            }
          />

          {/* Only meaningful for a flyer, so hidden entirely for the usual case
              rather than shown as a row of "not shown". */}
          {isFlyer ? (
            <>
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
              <TicketLink raw={extraction.ticket_url} />
            </>
          ) : null}
        </dl>
      </div>

      <div className="mt-6">
        <Label>
          Artists found — edit or uncheck anything that isn&apos;t right
        </Label>
        {artists.length === 0 ? (
          <p className="text-sm text-muted">
            No artist names were legible in that one. Try a screenshot that shows
            artist or song names as text rather than only cover art.
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
                  value={artist.prominence ?? ""}
                  aria-label={`How ${artist.name} appeared`}
                  onChange={(event) =>
                    setArtists((current) =>
                      current.map((a, i) =>
                        i === index
                          ? {
                              ...a,
                              prominence:
                                event.target.value === ""
                                  ? null
                                  : (event.target.value as Prominence),
                            }
                          : a,
                      ),
                    )
                  }
                  className="w-48"
                >
                  <option value="">unclear</option>
                  <option value="primary">an artist I follow</option>
                  <option value="mentioned">just on a song</option>
                </Select>
                {artist.confidence !== null && artist.confidence < 0.6 ? (
                  <span className="flex items-center gap-1.5 text-xs text-pixel-2">
                    <PixelDot size={6} color="var(--pixel-2)" /> hard to read
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-faint">
          &ldquo;An artist I follow&rdquo; counts more than a name that only turned
          up beside a song.
          {artists.length > DEFAULT_KEEP_LIMIT ? (
            <>
              {" "}
              That screenshot had {artists.length} names, so only the featured ones
              are ticked — check any others you want counted.{" "}
              <button
                type="button"
                className="text-accent underline"
                onClick={() =>
                  setArtists((current) =>
                    current.map((artist) => ({ ...artist, keep: true })),
                  )
                }
              >
                Select all
              </button>
            </>
          ) : null}
        </p>
      </div>

      {tracks.length > 0 ? (
        <div className="mt-5">
          <Label>Songs it read</Label>
          <ul className="flex flex-wrap gap-2">
            {tracks.slice(0, 24).map((track, index) => (
              <li
                key={`${index}-${track.title}`}
                className="border border-border bg-surface-raised px-2.5 py-1 text-xs text-muted"
              >
                {track.title}
                {track.artist ? (
                  <span className="text-faint"> — {track.artist}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {tracks.length > 24 ? (
            <p className="mt-2 text-xs text-faint">
              and {tracks.length - 24} more
            </p>
          ) : null}
        </div>
      ) : null}

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

/**
 * A ticket URL read off a flyer.
 *
 * This value came out of a picture, so it is untrusted: `safeExternalUrl` accepts
 * only http(s) and discards anything else, which is what stops a doctored image
 * turning into a `javascript:` link here. Shown as plain text when it fails that
 * check, so the user can still see what was read.
 */
function TicketLink({ raw }: { raw: string | null }) {
  const safe = safeExternalUrl(raw);

  if (!raw) return <Detail label="Ticket link" value={null} />;

  return (
    <div>
      <dt className="label-pixel">Ticket link</dt>
      <dd className="truncate">
        {safe ? (
          <a
            href={safe}
            className="text-accent underline"
            rel="noreferrer noopener"
            target="_blank"
          >
            {safe}
          </a>
        ) : (
          <span className="text-faint" title="Not a usable http(s) link">
            {raw} (unusable)
          </span>
        )}
      </dd>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="label-pixel">{label}</dt>
      <dd className={value ? "text-text" : "text-faint italic"}>
        {value ?? "not shown"}
      </dd>
    </div>
  );
}
