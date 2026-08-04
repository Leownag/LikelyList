"use client";

import { useState } from "react";
import { Button, Notice, Select } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import {
  useDetectedCitySlug,
  useDetectedTimezone,
} from "@/lib/use-detected-region";

export type SubscribeCity = { slug: string; name: string; stateCode: string | null };
export type SubscribeGenre = { id: number; name: string };

/**
 * Subscribe without creating an account.
 *
 * The region is guessed from the browser's timezone rather than an IP lookup — no
 * third party, no permission prompt — and then shown as an editable dropdown,
 * because `America/New_York` covers Maine to Florida and a silent wrong guess is
 * worse than an obvious editable one.
 *
 * Nothing is subscribed here. The server records the request and sends one
 * confirmation email; the address only joins the send list when that link is
 * clicked. The response text is intentionally the same whether the address is new
 * or already registered, so this cannot be used to probe who has an account.
 */
export function AnonymousSubscribe({
  cities,
  genres,
  presetCitySlug,
  presetGenreIds,
}: {
  cities: SubscribeCity[];
  genres: SubscribeGenre[];
  /** Set when arriving from /explore, so the current search carries over. */
  presetCitySlug?: string;
  presetGenreIds?: number[];
}) {
  const [email, setEmail] = useState("");
  const [genreIds, setGenreIds] = useState<Set<number>>(
    () => new Set(presetGenreIds ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Read from the browser rather than detected in an effect — see
  // useDetectedRegion for why that shape causes cascading renders.
  const detectedCitySlug = useDetectedCitySlug();
  const timezone = useDetectedTimezone();

  // The city is derived, with an explicit user choice taking precedence. Holding
  // only the override in state means there is nothing to synchronise, and the
  // detected value never has to be written into state at all.
  const [chosenCitySlug, setChosenCitySlug] = useState<string | null>(null);
  const detectedIsUsable = cities.some((city) => city.slug === detectedCitySlug);
  const citySlug =
    chosenCitySlug ??
    presetCitySlug ??
    (detectedIsUsable ? detectedCitySlug : cities[0]?.slug) ??
    "";
  const showingDetected =
    chosenCitySlug === null && !presetCitySlug && detectedIsUsable;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          citySlug,
          genreIds: [...genreIds],
          timezone,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "That didn't go through. Try again in a moment.");
        return;
      }
      setDone(payload.message ?? "Check your inbox.");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="border border-accent/40 bg-surface/60 p-5 backdrop-blur-sm">
        <p className="flex items-start gap-2.5 text-sm text-text">
          <span className="mt-1.5">
            <PixelDot size={6} />
          </span>
          <span>{done}</span>
        </p>
      </div>
    );
  }

  const topGenres = genres.slice(0, 8);

  return (
    // Semi-transparent so the pixel mosaic behind it shows through, with a blur so
    // the input text stays readable over it.
    <form
      onSubmit={submit}
      className="border border-border-strong/70 bg-surface/50 p-5 backdrop-blur-sm"
    >
      <p className="label-pixel">no account needed</p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          autoComplete="email"
          className="w-full flex-1 border border-border-strong/60 bg-bg/40 px-3 py-2.5 text-sm text-text placeholder:text-faint focus:border-accent focus:bg-bg/70 focus:outline-none"
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          {busy ? "Sending…" : "Subscribe"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Shows near</span>
        <Select
          value={citySlug}
          onChange={(event) => setChosenCitySlug(event.target.value)}
          aria-label="City"
          className="w-auto border-border-strong/60 bg-bg/40 py-1 text-xs"
        >
          {cities.map((city) => (
            <option key={city.slug} value={city.slug}>
              {city.name}
              {city.stateCode ? `, ${city.stateCode}` : ""}
            </option>
          ))}
        </Select>
        {showingDetected ? (
          <span className="text-faint">
            detected from your timezone — change it if it&apos;s wrong
          </span>
        ) : null}
      </div>

      {topGenres.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs text-faint">
            Optional — pick a few genres, or leave it and choose later:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topGenres.map((genre) => {
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
                      : "border-border-strong/50 bg-bg/30 text-muted hover:text-text"
                  }`}
                >
                  {genre.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-faint">
        We send one confirmation email and nothing else until you click it. One
        email a week after that, unsubscribe in one click.
      </p>
    </form>
  );
}
