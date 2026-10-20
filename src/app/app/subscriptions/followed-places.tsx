"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label, Notice, StatusLine } from "@/components/ui";
import { CityTypeahead } from "@/components/city-typeahead";
import { placeLabel } from "@/lib/places";
import { followPlace, unfollowPlace } from "./actions";
import { FOLLOWED_PLACE_LIMIT } from "@/lib/limits";
import type { PlaceSuggestion } from "@/lib/explore/types";

export type FollowedPlace = {
  id: number;
  name: string;
  stateCode: string | null;
};

/**
 * Towns outside the curated 43.
 *
 * Deliberately its own control rather than more chips in the grid: the grid is a fixed
 * list of 43 that commits on Save, and these arrive one at a time out of a search over
 * every US place. Trying to express both in one widget is what kept this feature
 * unbuilt while the schema was already there.
 *
 * Adds and removes take effect immediately. There is no ambiguity to hold open — a
 * reader has named one town — and the ceiling lives on the server, so the message about
 * hitting it is the server's to give.
 */
export function FollowedPlaces({ places }: { places: FollowedPlace[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<PlaceSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What just happened, in the same place ArtistSearch says it. */
  const [status, setStatus] = useState<string | null>(null);
  /** Typed but not committed, so the dead Follow button can explain itself. */
  const [pendingText, setPendingText] = useState("");
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  const visible = places.filter((place) => !removed.has(place.id));

  async function add() {
    if (!choice) return;
    setAdding(true);
    setError(null);
    try {
      await followPlace(choice.geoid);
      setStatus(`Now following ${label(choice)}.`);
      setChoice(null);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not follow that town.",
      );
    } finally {
      setAdding(false);
    }
  }

  function remove(id: number) {
    const gone = places.find((place) => place.id === id);
    setRemoved((current) => new Set(current).add(id));
    setError(null);
    if (gone) setStatus(`Stopped following ${label(gone)}.`);
    startTransition(async () => {
      try {
        await unfollowPlace(id);
      } catch {
        // Put it back rather than leaving the screen claiming something that did not
        // happen.
        setRemoved((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setError("Could not remove that town. Try again.");
      }
    });
  }

  const label = (place: { name: string; stateCode: string | null }) =>
    placeLabel(place.name, place.stateCode);

  const full = visible.length >= FOLLOWED_PLACE_LIMIT;
  // Why the button is dead, said where the button is. It was simply disabled,
  // which reads as broken when you have typed a town name and can see it in the
  // list above.
  const blocker = full
    ? `That is ${FOLLOWED_PLACE_LIMIT} towns already — remove one before adding another.`
    : !choice && pendingText.trim()
      ? "Pick a town from the list to follow it."
      : null;

  return (
    <Card className="p-5">
      <Label htmlFor="follow-place">Anywhere else</Label>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <div className="min-w-64 flex-1">
          <CityTypeahead
            id="follow-place"
            value={choice}
            onChange={(place) => {
              setChoice(place);
              setError(null);
              setStatus(null);
            }}
            onDraftChange={setPendingText}
          />
        </div>
        <Button onClick={add} disabled={!choice || adding || full}>
          {adding ? "Adding…" : "Follow"}
        </Button>
      </div>

      <p className="mt-3 text-xs text-faint">
        Every incorporated town and Census place in the US — not just the metros
        above. Shows are found within a radius of the point, so a small town picks
        up whatever is listed nearby.
      </p>

      <div className="mt-2">
        <StatusLine tone={blocker ? "error" : "success"}>
          {blocker ?? status}
        </StatusLine>
      </div>

      {error ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <ul
          className={`mt-4 flex flex-wrap gap-2 ${pending ? "opacity-80" : ""}`}
          aria-busy={pending}
        >
          {visible.map((place) => (
            <li
              key={place.id}
              className="flex items-center gap-2 border border-border bg-surface-raised px-3 py-1.5 text-xs"
            >
              <span className="text-text">{place.name}</span>
              {place.stateCode ? (
                <span className="font-mono text-faint">{place.stateCode}</span>
              ) : null}
              <button
                type="button"
                onClick={() => remove(place.id)}
                // Padded: the hit area used to be the glyph itself, roughly
                // 8x16px, which is below any pointer-target guidance and
                // unusable on a phone.
                className="-my-1 px-1.5 py-1 text-faint hover:text-danger"
                aria-label={`Stop following ${label(place)}`}
                title={`Stop following ${label(place)}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
