"use client";

import { useState } from "react";
import { Button, Notice, Select } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import {
  useDetectedCitySlug,
  useDetectedTimezone,
} from "@/lib/use-detected-region";

export type SubscribeCity = {
  slug: string;
  name: string;
  stateCode: string | null;
  /**
   * Present for the curated metros, which are seeded with coordinates.
   *
   * Unused by this component — it subscribes by city slug — but /explore needs it to
   * seed its search box with the reader's detected city without a second lookup.
   */
  latitude?: number | null;
  longitude?: number | null;
};
export type SubscribeGenre = { id: number; name: string };

/**
 * A search that has already happened, to subscribe to as-is.
 *
 * Set by /explore, where the reader has just picked a place and genres and pressed
 * "Email me this every Wednesday". With this present the box asks for the address and
 * nothing else: re-offering a city dropdown there was not a second chance to choose, it
 * was a different question — the dropdown holds 43 curated metros and the search above
 * can be any of 32,329 towns or a ZIP, so it silently answered "Amherst" with "Boston".
 *
 * `placeGeoid` and `postalCode` are names rather than coordinates; the server resolves
 * them (see resolvePlace).
 */
export type SubscribePreset = {
  /** "Amherst, MA" — what the search above was centred on, for the confirmation line. */
  label: string;
  citySlug?: string | null;
  placeGeoid?: string | null;
  postalCode?: string | null;
  genreIds: number[];
};

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
  preset,
}: {
  cities: SubscribeCity[];
  genres: SubscribeGenre[];
  /** A search to subscribe to verbatim. When set, this box only asks for the address. */
  preset?: SubscribePreset;
}) {
  const [email, setEmail] = useState("");
  const [genreIds, setGenreIds] = useState<Set<number>>(
    () => new Set(preset?.genreIds ?? []),
  );
  const [showAllGenres, setShowAllGenres] = useState(false);
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
    preset?.citySlug ??
    (detectedIsUsable ? detectedCitySlug : cities[0]?.slug) ??
    "";
  const showingDetected =
    chosenCitySlug === null && !preset && detectedIsUsable;

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    // Checked here as well as on the server so the reader is told before the
    // round trip, and told next to the chips rather than next to the email field.
    if (genreIds.size === 0) {
      setError("Pick at least one genre — that's what the email filters on.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          citySlug: preset ? (preset.citySlug ?? null) : citySlug,
          placeGeoid: preset?.placeGeoid ?? null,
          postalCode: preset?.postalCode ?? null,
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

  // Eight keeps the form short enough to read in one glance, but it used to be
  // all a visitor could see or pick — under copy claiming it was "what the email
  // filters on". Somebody who ticked all eight believed they had chosen
  // everything and subscribed to eight genres out of twenty-one.
  const COLLAPSED = 8;
  const visibleGenres = showAllGenres ? genres : genres.slice(0, COLLAPSED);
  const hiddenCount = genres.length - visibleGenres.length;

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
          // Hand-rolled rather than the Input primitive, for the glassy panel it
          // sits in. Kept that way here, but no longer suppressing the focus
          // outline, and text-base below sm so iOS does not zoom the page.
          className="w-full flex-1 border border-border-strong/60 bg-bg/40 px-3 py-2.5 text-base text-text placeholder:text-faint focus:border-accent focus:bg-bg/70 sm:text-sm"
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          {busy ? "Sending…" : "Subscribe"}
        </Button>
      </div>

      {preset ? (
        <p className="mt-3 text-xs text-muted">
          Shows near <span className="text-text">{preset.label}</span> ·{" "}
          <span className="text-text">{summariseGenres(genres, preset.genreIds)}</span>
          <span className="text-faint"> — the search you just ran</span>
        </p>
      ) : (
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
      )}

      {!preset && visibleGenres.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs text-faint">
            Pick at least one — this is what the email filters on:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleGenres.map((genre) => {
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

          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllGenres(true)}
              className="mt-2 text-xs text-accent underline"
            >
              {`Show ${hiddenCount} more`}
            </button>
          ) : null}
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
        {preset ? " You can change all of this once you're in." : ""}
      </p>
    </form>
  );
}

/** "Rock, Pop and 2 more", or "every genre" when nothing was filtered out. */
export function summariseGenres(genres: SubscribeGenre[], chosen: number[]): string {
  if (genres.length > 0 && chosen.length >= genres.length) return "every genre";

  const names = genres
    .filter((genre) => chosen.includes(genre.id))
    .map((genre) => genre.name);
  if (names.length === 0) return "every genre";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}
