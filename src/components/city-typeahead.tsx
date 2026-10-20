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
 * often not on the list at all.
 */

/** Long enough that a typed name settles, short enough to feel immediate. */
const DEBOUNCE_MS = 180;

/** Below this there is nothing useful to suggest and every keystroke is a query. */
const MIN_QUERY = 2;

/** What the list is currently able to say. */
type Status = "idle" | "searching" | "empty" | "error";

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
  const optionId = (index: number) => `${inputId}-option-${index}`;

  /** What the reader has typed. Null means "showing the current selection". */
  const [draft, setDraft] = useState<string | null>(null);
  const [matches, setMatches] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  /** Which option Enter would take. Always a real index once there are matches. */
  const [active, setActive] = useState(0);

  // Guards against a slow earlier response overwriting a newer one.
  const requestId = useRef(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // A guess from the browser's timezone, not a geolocation prompt. Null on the
  // server render and in a browser we cannot place, in which case the API keeps
  // its old rank-only ordering.
  const near = useDetectedPoint();

  const label = (place: PlacePoint) => placeLabel(place.name, place.stateCode);

  const query = draft ?? "";

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < MIN_QUERY) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setStatus("searching");
      try {
        const params = new URLSearchParams({ q: needle });
        if (near) params.set("near", `${near.latitude},${near.longitude}`);
        const response = await fetch(`/api/places/search?${params}`);
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as { places?: PlaceSuggestion[] };
        if (id !== requestId.current) return;
        const places = payload.places ?? [];
        setMatches(places);
        setActive(0);
        setStatus(places.length === 0 ? "empty" : "idle");
      } catch {
        // Distinguished from "no match" on purpose. Both used to render the same
        // sentence, so a dropped connection told the reader their town does not
        // exist.
        if (id === requestId.current) {
          setMatches([]);
          setStatus("error");
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, near]);

  // Keeps the keyboard-selected option on screen in a list that scrolls.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Clearing lives in the change handler rather than the effect: the state change
  // belongs to the keystroke that caused it, and setState inside an effect is both a
  // lint error and a wasted render.
  function changeQuery(next: string) {
    setDraft(next);
    setOpen(true);
    setActive(0);
    if (next.trim().length < MIN_QUERY) {
      // Cancels any in-flight query so a late response cannot repopulate a list the
      // reader has just cleared.
      requestId.current += 1;
      setMatches([]);
      setStatus("idle");
    }
  }

  function choose(place: PlaceSuggestion) {
    requestId.current += 1;
    onChange(place);
    setDraft(null);
    setMatches([]);
    setStatus("idle");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        event.key === "ArrowDown"
          ? Math.min(current + 1, matches.length - 1)
          : Math.max(current - 1, 0),
      );
      return;
    }

    if (event.key === "Enter") {
      // The highlighted option, not always the first. Taking matches[0] meant the
      // only way to reach the third suggestion was to keep typing until it was
      // the first, which is most of why this box felt like it needed so much
      // typing.
      const place = matches[active];
      if (!place) return;
      event.preventDefault();
      choose(place);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setDraft(null);
    }
  }

  const typedEnough = query.trim().length >= MIN_QUERY;
  const listOpen = open && typedEnough;

  return (
    <div className="relative">
      <Input
        id={inputId}
        type="text"
        autoComplete="off"
        // A name, so the first letter of each word is right; the rest off, because
        // a place name is not a word a corrector knows.
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        // Names the option Enter would take, so a screen reader follows the arrow
        // keys instead of being told only that a list exists.
        aria-activedescendant={
          listOpen && matches.length > 0 ? optionId(active) : undefined
        }
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
        // Closes the list but keeps what was typed. Discarding the draft here meant
        // tapping anywhere else on a phone silently reverted the field to the
        // previous selection, losing a half-typed name.
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />

      {/* Nothing is suggested until something is typed. Showing an arbitrary handful
          on focus made the component look like it had auto-chosen one of them. */}
      {listOpen ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto border border-border-strong bg-surface-raised shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-faint" role="status">
              {status === "searching"
                ? "Looking…"
                : status === "error"
                  ? "Could not reach the server. Check your connection."
                  : "No US city or town matches that."}
            </li>
          ) : (
            matches.map((place, index) => (
              <li key={place.geoid} role="presentation">
                <button
                  type="button"
                  id={optionId(index)}
                  role="option"
                  ref={index === active ? activeRef : undefined}
                  aria-selected={index === active}
                  // onPointerDown rather than onClick: blur fires first on a click
                  // and would close the list before the handler ran. Pointer events
                  // cover touch without relying on a synthesised mouse event.
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(place);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm text-text ${
                    index === active ? "bg-surface" : ""
                  }`}
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
