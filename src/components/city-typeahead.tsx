"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui";
import type { PlacePoint, PlaceSuggestion } from "@/lib/explore/types";
import { placeLabel } from "@/lib/places";
import { useDetectedPoint } from "@/lib/use-detected-region";

/**
 * Type a city, pick from what matches — over every US place, not a shortlist.
 *
 * Replaced a 43-option dropdown, then replaced its own client-side filter. Suggestions
 * now come from /api/places/search, which queries 32,329 Census places: the point is
 * that no city is un-findable, and a list that size cannot be shipped to the browser
 * to be filtered there.
 *
 * A suggestion carries its own coordinates, which is what makes this work at all —
 * searching goes out to Ticketmaster as a point plus a radius, so a place does not
 * need to be one we curated or a name Ticketmaster would recognise.
 *
 * The state code is always shown: "Portland" is two cities people actually mean, and
 * the abbreviation is what makes the choice unambiguous rather than decoration.
 *
 * Suggestions are ordered by how close they are to the reader, within bands of
 * significance. Before that the order came from a `rank` whose tiebreak is land
 * area, so Camarillo, CA beat Cambridge, MA for "cam" regardless of who was
 * typing — and with only a handful of rows shown, the place somebody meant was
 * often not on the list at all. That is what made this box feel like it needed
 * a lot of typing.
 */

/** Long enough that a typed name settles, short enough to feel immediate. */
const DEBOUNCE_MS = 180;

/** Below this there is nothing useful to suggest and every keystroke is a query. */
const MIN_QUERY = 2;

export function CityTypeahead({
  value,
  onChange,
  id,
}: {
  /** Accepts a curated city too, which has coordinates but no Census id. */
  value: PlacePoint | null;
  onChange: (place: PlaceSuggestion) => void;
  id?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-options`;

  /** What the reader has typed. Null means "showing the current selection". */
  const [draft, setDraft] = useState<string | null>(null);
  const [matches, setMatches] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  // Guards against a slow earlier response overwriting a newer one.
  const requestId = useRef(0);

  // A guess from the browser's timezone, not a geolocation prompt. Null on the
  // server render and in a browser we cannot place, in which case the API keeps
  // its old rank-only ordering.
  const near = useDetectedPoint();

  const label = (place: PlacePoint) =>
    placeLabel(place.name, place.stateCode);

  const query = draft ?? "";

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < MIN_QUERY) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: needle });
        if (near) params.set("near", `${near.latitude},${near.longitude}`);
        const response = await fetch(`/api/places/search?${params}`);
        const payload = (await response.json()) as { places?: PlaceSuggestion[] };
        if (id !== requestId.current) return;
        setMatches(payload.places ?? []);
      } catch {
        if (id === requestId.current) setMatches([]);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, near]);

  // Clearing lives in the change handler rather than the effect: the state change
  // belongs to the keystroke that caused it, and setState inside an effect is both a
  // lint error and a wasted render.
  function changeQuery(next: string) {
    setDraft(next);
    setOpen(true);
    if (next.trim().length < MIN_QUERY) {
      // Cancels any in-flight query so a late response cannot repopulate a list the
      // reader has just cleared.
      requestId.current += 1;
      setMatches([]);
      setSearching(false);
    }
  }

  function choose(place: PlaceSuggestion) {
    requestId.current += 1;
    onChange(place);
    setDraft(null);
    setMatches([]);
    setOpen(false);
  }

  const typedEnough = query.trim().length >= MIN_QUERY;

  return (
    <div className="relative">
      <Input
        id={inputId}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && typedEnough}
        aria-controls={listId}
        aria-autocomplete="list"
        // Shows the current selection when nothing has been typed, so the reader can
        // always see what they are about to search rather than an empty box that has
        // quietly kept a value.
        value={draft ?? (value ? label(value) : "")}
        placeholder="Start typing a city"
        onChange={(event) => changeQuery(event.target.value)}
        onFocus={(event) => {
          setOpen(true);
          // Select the current value so the first keystroke replaces it. Without this,
          // focusing a field reading "New York, NY" and typing "port" produces
          // "New York, NYport" and matches nothing.
          event.target.select();
        }}
        // Committed on a delay so a click on an option is not swallowed by the list
        // unmounting first.
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            setDraft(null);
          }, 120);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches.length > 0) {
            // Enter takes the top match, which is what the reader is looking at.
            event.preventDefault();
            choose(matches[0]);
          } else if (event.key === "Escape") {
            setOpen(false);
            setDraft(null);
          }
        }}
      />

      {/* Nothing is suggested until something is typed. Showing an arbitrary handful
          on focus made the component look like it had auto-chosen one of them. */}
      {open && typedEnough ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto border border-border-strong bg-surface-raised shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-faint">
              {searching ? "Looking…" : "No US city or town matches that."}
            </li>
          ) : (
            matches.map((place) => (
              <li key={place.geoid}>
                <button
                  type="button"
                  role="option"
                  aria-selected={label(place) === (value ? label(value) : "")}
                  // onMouseDown rather than onClick: blur fires first on a click and
                  // would close the list before the handler ran.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(place);
                  }}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
                >
                  <span>{place.name}</span>
                  {place.stateCode ? (
                    <span className="font-mono text-xs text-faint">
                      {place.stateCode}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
