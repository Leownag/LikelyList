"use client";

import { useState } from "react";
import { Button, Card, EmptyState, Input, Label, Notice, Select } from "@/components/ui";
import { PixelDot, PixelRule } from "@/components/pixel";
import {
  AnonymousSubscribe,
  type SubscribeCity,
  type SubscribeGenre,
} from "@/components/anonymous-subscribe";
import { useDetectedCitySlug } from "@/lib/use-detected-region";
import type { ExploreResponse } from "@/lib/explore/types";

type Mode = "city" | "zip";

/**
 * Browse a week's shows without an account.
 *
 * Exists to answer "is this actually useful to me?" before asking for an email.
 * Nothing here subscribes anything — the subscribe box only appears after a
 * search has returned something, carrying that search's settings, so the ask
 * arrives once the answer is already on screen.
 */
export function ExploreClient({
  cities,
  genres,
}: {
  cities: SubscribeCity[];
  genres: SubscribeGenre[];
}) {
  const [mode, setMode] = useState<Mode>("city");
  const [postalCode, setPostalCode] = useState("");
  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResponse | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);

  // Derived rather than copied into state on mount: an effect that setStates the
  // detected value causes a cascading render (react-hooks/set-state-in-effect).
  const detectedCitySlug = useDetectedCitySlug();
  const [chosenCitySlug, setChosenCitySlug] = useState<string | null>(null);
  const citySlug =
    chosenCitySlug ??
    (cities.some((city) => city.slug === detectedCitySlug)
      ? detectedCitySlug
      : cities[0]?.slug) ??
    "";

  async function search() {
    setBusy(true);
    setError(null);
    setShowSubscribe(false);

    try {
      const response = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          citySlug: mode === "city" ? citySlug : null,
          postalCode: mode === "zip" ? postalCode.trim() : null,
          genreIds: [...genreIds],
        }),
      });

      const payload = (await response.json()) as Partial<ExploreResponse> & {
        error?: string;
      };
      if (!response.ok || !payload.events) {
        setError(payload.error ?? "That search didn't work.");
        setResult(null);
        return;
      }
      setResult({
        events: payload.events,
        window: payload.window ?? "",
        totalBeforeGenreFilter:
          payload.totalBeforeGenreFilter ?? payload.events.length,
      });
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="explore-mode">Search by</Label>
            <Select
              id="explore-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as Mode)}
              className="w-32"
            >
              <option value="city">City</option>
              <option value="zip">ZIP code</option>
            </Select>
          </div>

          {mode === "city" ? (
            <div className="min-w-48 flex-1">
              <Label htmlFor="explore-city">City</Label>
              <Select
                id="explore-city"
                value={citySlug}
                onChange={(event) => setChosenCitySlug(event.target.value)}
              >
                {cities.map((city) => (
                  <option key={city.slug} value={city.slug}>
                    {city.name}
                    {city.stateCode ? `, ${city.stateCode}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="min-w-48 flex-1">
              <Label htmlFor="explore-zip">ZIP code</Label>
              <Input
                id="explore-zip"
                inputMode="numeric"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                placeholder="02134"
                maxLength={10}
              />
            </div>
          )}

          <Button onClick={search} disabled={busy}>
            {busy ? "Searching…" : "Show me this week"}
          </Button>
        </div>

        {genres.length > 0 ? (
          <div className="mt-5">
            <Label>Genres — leave empty for everything</Label>
            <div className="flex flex-wrap gap-1.5">
              {genres.map((genre) => {
                const active = genreIds.has(genre.id);
                return (
                  <button
                    key={genre.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setGenreIds((current) => {
                        const next = new Set(current);
                        if (next.has(genre.id)) next.delete(genre.id);
                        else next.add(genre.id);
                        return next;
                      })
                    }
                    className={`border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-border bg-surface-raised text-muted hover:border-border-strong hover:text-text"
                    }`}
                  >
                    {genre.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </Card>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {result ? (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="label-pixel">
              {result.events.length} of {result.totalBeforeGenreFilter} shows ·{" "}
              {result.window}
            </p>
            {result.events.length > 0 ? (
              <Button variant="outline" onClick={() => setShowSubscribe(true)}>
                Email me this every Friday
              </Button>
            ) : null}
          </div>

          <PixelRule className="mt-3" />

          {showSubscribe ? (
            <div className="mt-5">
              <AnonymousSubscribe
                cities={cities}
                genres={genres}
                // Carries this exact search into the subscription, so the button
                // does what it says.
                presetCitySlug={mode === "city" ? citySlug : undefined}
                presetGenreIds={[...genreIds]}
              />
              {mode === "zip" ? (
                <p className="mt-2 text-xs text-faint">
                  The weekly email works by city rather than ZIP, so pick the closest
                  one above.
                </p>
              ) : null}
            </div>
          ) : null}

          {result.events.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="nothing matched">
                {genreIds.size > 0
                  ? "Nothing in those genres this week. Try clearing the genre filter."
                  : "Nothing listed there for the coming week."}
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {result.events.map((event) => (
                <li key={event.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-accent">
                          {event.dateLabel}
                          {event.timeLabel ? ` · ${event.timeLabel}` : ""}
                        </p>
                        <h2 className="mt-1.5 text-base font-semibold tracking-tight">
                          {event.url ? (
                            <a
                              href={event.url}
                              className="hover:underline"
                              rel="noreferrer noopener"
                              target="_blank"
                            >
                              {event.name}
                            </a>
                          ) : (
                            event.name
                          )}
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                          {[event.venueName, event.cityLabel]
                            .filter(Boolean)
                            .join(" · ")}
                          {event.genreName ? ` · ${event.genreName}` : ""}
                        </p>

                        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {event.performers.map((performer) => (
                            <li
                              key={performer.name}
                              className="flex items-center gap-1.5"
                            >
                              <PixelDot
                                size={5}
                                color={
                                  performer.isHeadliner
                                    ? "var(--pixel-1)"
                                    : "var(--border-strong)"
                                }
                              />
                              <span className="text-text">{performer.name}</span>
                              <a
                                href={performer.youtubeUrl}
                                className="text-faint underline hover:text-muted"
                                rel="noreferrer noopener"
                                target="_blank"
                              >
                                YT
                              </a>
                              <a
                                href={performer.spotifyUrl}
                                className="text-faint underline hover:text-muted"
                                rel="noreferrer noopener"
                                target="_blank"
                              >
                                SP
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {event.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={event.imageUrl}
                          alt={`Promotional image for ${event.name}`}
                          width={140}
                          height={79}
                          className="border border-border"
                        />
                      ) : null}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
