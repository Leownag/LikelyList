"use client";

import { useState } from "react";
import { Button, Card, EmptyState, Input, Label, Notice, Select } from "@/components/ui";
import { PixelDot, PixelRule } from "@/components/pixel";
import { CityTypeahead } from "@/components/city-typeahead";
import { ServiceLink } from "@/components/service-icon";
import { AddToCalendar } from "@/components/add-to-calendar";
import { PinButton } from "@/components/pin-button";
import {
  AnonymousSubscribe,
  type SubscribeCity,
  type SubscribeGenre,
} from "@/components/anonymous-subscribe";
import { useDetectedCitySlug } from "@/lib/use-detected-region";
import {
  RADIUS_CHOICES,
  type ExploreResponse,
  type PlacePoint,
  type PlaceSuggestion,
} from "@/lib/explore/types";
import { placeLabel } from "@/lib/places";

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
  signedIn,
  pinnedIds,
}: {
  cities: SubscribeCity[];
  genres: SubscribeGenre[];
  signedIn: boolean;
  /** Already-pinned event ids, so the button starts in the right state. */
  pinnedIds: string[];
}) {
  const alreadyPinned = new Set(pinnedIds);
  const [mode, setMode] = useState<Mode>("city");
  const [postalCode, setPostalCode] = useState("");
  // Deliberately not exposed before the first search. Someone arriving has no way
  // to know whether fifty miles is too wide or too narrow for where they live;
  // once there is a count on screen the question becomes answerable.
  const [radiusMiles, setRadiusMiles] = useState<number>(50);
  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResponse | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);

  // Derived rather than copied into state on mount: an effect that setStates the
  // detected value causes a cascading render (react-hooks/set-state-in-effect).
  //
  // The search runs on coordinates, so what is held here is a point rather than a
  // city slug — that is what lets the box offer any of 32,329 US places instead of
  // the 43 the digest curates. The detected city seeds it because those rows carry
  // coordinates too.
  const detectedCitySlug = useDetectedCitySlug();
  const [chosenPlace, setChosenPlace] = useState<PlaceSuggestion | null>(null);
  /** Typed into the city box but never committed to a suggestion. */
  const [pendingCity, setPendingCity] = useState("");

  const detectedCity =
    cities.find((city) => city.slug === detectedCitySlug) ?? cities[0] ?? null;
  const detectedPoint: PlacePoint | null =
    detectedCity?.latitude != null && detectedCity?.longitude != null
      ? {
          name: detectedCity.name,
          stateCode: detectedCity.stateCode,
          latitude: Number(detectedCity.latitude),
          longitude: Number(detectedCity.longitude),
        }
      : null;

  // The timezone guess is a starting point, not an answer: it stands in only
  // while the reader has expressed no opinion at all. The moment they start
  // typing, `search` refuses rather than quietly falling back to it.
  const place: PlacePoint | null = chosenPlace ?? detectedPoint;

  async function search(overrideRadius?: number) {
    const radius = overrideRadius ?? radiusMiles;

    // The bug this replaces: typing "Amherst" and clicking the button searched
    // whatever the timezone guessed, usually New York, and the only hint was a
    // line folded inside a collapsed "Advanced" panel. Half-typed is not a
    // place, and guessing one is worse than asking.
    if (mode === "city" && pendingCity.trim().length > 0) {
      setError(
        `Pick a place from the list — we can't tell which “${pendingCity.trim()}” you mean.`,
      );
      setResult(null);
      return;
    }

    setBusy(true);
    setError(null);
    setShowSubscribe(false);

    try {
      const response = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: mode === "city" ? place?.latitude : undefined,
          longitude: mode === "city" ? place?.longitude : undefined,
          placeLabel:
            mode === "city" && place
              ? placeLabel(place.name, place.stateCode)
              : undefined,
          postalCode: mode === "zip" ? postalCode.trim() : null,
          genreIds: [...genreIds],
          radiusMiles: radius,
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
        placeLabel: payload.placeLabel ?? null,
        radiusMiles: payload.radiusMiles ?? null,
        truncated: payload.truncated ?? false,
      });
      // Kept in sync with what the server actually used, so the control reflects
      // the result on screen rather than the reader's last click.
      if (payload.radiusMiles) setRadiusMiles(payload.radiusMiles);
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
              <CityTypeahead
                id="explore-city"
                value={place}
                onChange={(next) => {
                  setChosenPlace(next);
                  setError(null);
                }}
                onDraftChange={setPendingCity}
              />
              {!chosenPlace && detectedPoint ? (
                <p className="mt-1 text-xs text-faint">
                  Detected from your timezone — change it if it&apos;s wrong.
                </p>
              ) : null}
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

          {/* Wrapped rather than passed directly: `search` now takes an optional
              radius, and onClick would hand it a MouseEvent. */}
          <Button onClick={() => void search()} disabled={busy}>
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
              {/* "99 of 99 shows" reads as a cap being hit. The ratio only says
                  anything when the genre filter actually removed some. */}
              {result.events.length === result.totalBeforeGenreFilter
                ? `${result.events.length} shows`
                : `${result.events.length} of ${result.totalBeforeGenreFilter} shows`}{" "}
              · {result.window}
            </p>
            {result.events.length > 0 ? (
              <Button variant="outline" onClick={() => setShowSubscribe(true)}>
                Email me this every Wednesday
              </Button>
            ) : null}
          </div>

          {/* Results are date-ordered and we ask for one page, so a busy city
              runs out of page before it runs out of week. Saying so is the
              difference between "nothing later this week" and "we stopped
              looking". */}
          {result.truncated ? (
            <p className="mt-2 text-xs text-faint">
              Ticketmaster returned a full page, so the last days of this window
              are probably incomplete. A smaller radius narrows it.
            </p>
          ) : null}

          {/*
            Distance, shown once there is a result and no longer folded away.
            It cannot be judged in advance — fifty miles is generous in New England
            and barely leaves the county in Texas — so it only becomes a question the
            reader can answer next to a count: "98 shows, want to look further?".
            It was behind a <details> labelled "Advanced", which is where a control
            goes to be ignored, and the explanation beneath it was about how
            Ticketmaster's API behaves rather than about what the reader gets.
          */}
          {result.radiusMiles ? (
            <div className="mt-3 border border-border bg-surface-raised">
              <div className="px-3 py-3">
                <Label>
                  How far to look — within {result.radiusMiles} miles
                  {result.placeLabel ? ` of ${result.placeLabel}` : ""}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {RADIUS_CHOICES.map((miles) => {
                    const active = miles === result.radiusMiles;
                    return (
                      <button
                        key={miles}
                        type="button"
                        aria-pressed={active}
                        disabled={busy}
                        // Re-runs the search immediately rather than waiting for the
                        // main button: changing the distance IS the new search, and a
                        // control that silently does nothing until you press
                        // something else is the more confusing option.
                        onClick={() => {
                          setRadiusMiles(miles);
                          void search(miles);
                        }}
                        className={`border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                          active
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-border bg-surface text-muted hover:border-border-strong hover:text-text"
                        }`}
                      >
                        {miles} mi
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-faint">
                  Fifty miles is generous in New England and barely leaves the
                  county in Texas, so this is worth changing. It also shows where
                  the search was centred, which is how a mistyped ZIP gets noticed.
                </p>
              </div>
            </div>
          ) : null}

          <PixelRule className="mt-3" />

          {showSubscribe ? (
            <div className="mt-5">
              {/* This exact search, and no second set of controls — see
                  SubscribePreset for why re-asking was worse than not asking. */}
              <AnonymousSubscribe
                cities={cities}
                genres={genres}
                preset={{
                  label:
                    result.placeLabel ??
                    placeLabel(place?.name, place?.stateCode),
                  // A town chosen from the typeahead subscribes by GEOID; the detected
                  // metro nobody touched is a curated city, and keeping its slug is
                  // what keeps it visible in the city grid later.
                  citySlug:
                    mode === "city" && !chosenPlace ? (detectedCity?.slug ?? null) : null,
                  placeGeoid: mode === "city" ? (chosenPlace?.geoid ?? null) : null,
                  postalCode: mode === "zip" ? postalCode.trim() : null,
                  // No genre filter means the reader was shown everything, so that is
                  // what "email me this" has to subscribe to. The digest sends nothing
                  // to someone who follows no genre at all.
                  genreIds:
                    genreIds.size > 0
                      ? [...genreIds]
                      : genres.map((genre) => genre.id),
                }}
              />
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
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-mono text-xs text-accent">
                            {event.dateLabel}
                            {event.timeLabel ? ` · ${event.timeLabel}` : ""}
                          </p>
                          {/* Beside the date rather than at the bottom of the card:
                              the moment somebody decides they can make a date is the
                              moment they want it in their calendar. */}
                          <div className="flex flex-wrap items-center gap-2">
                            <AddToCalendar
                              event={{
                                title: event.name,
                                localDate: event.localDate,
                                localTime: event.localTime,
                                timezone: event.timezone,
                                venueName: event.venueName,
                                cityLabel: event.cityLabel,
                                url: event.url,
                              }}
                            />
                            <PinButton
                              signedIn={signedIn}
                              initiallyPinned={alreadyPinned.has(event.id)}
                              event={{
                                tmEventId: event.id,
                                name: event.name,
                                url: event.url,
                                localDate: event.localDate || null,
                                localTime: event.localTime,
                                timezone: event.timezone,
                                venueName: event.venueName,
                                cityLabel: event.cityLabel,
                                imageUrl: event.imageUrl,
                                genreName: event.genreName,
                                performers: event.performers
                                  .slice(0, 12)
                                  .map((performer) => ({
                                    name: performer.name,
                                    isHeadliner: performer.isHeadliner,
                                  })),
                              }}
                            />
                          </div>
                        </div>
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
                              {/*
                                The official marks, via the shared component, rather
                                than "YT" and "SP" — which nobody has to decode, and
                                which the brand guidelines would rather we did not
                                use in place of the logos. It degrades to the service
                                name alone until public/brand/ is populated, so the
                                link is never broken.
                              */}
                              <ServiceLink
                                service="youtube"
                                href={performer.youtubeUrl}
                                className="text-xs"
                              />
                              <ServiceLink
                                service="spotify"
                                href={performer.spotifyUrl}
                                className="text-xs"
                              />
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
