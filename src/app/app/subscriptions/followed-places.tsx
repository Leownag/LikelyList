"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Label, Notice } from "@/components/ui";
import { CityTypeahead } from "@/components/city-typeahead";
import { placeLabel } from "@/lib/places";
import { followPlace, unfollowPlace } from "./actions";
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
    setRemoved((current) => new Set(current).add(id));
    setError(null);
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

  const label = (place: FollowedPlace) => placeLabel(place.name, place.stateCode);

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
            }}
          />
        </div>
        <Button onClick={add} disabled={!choice || adding}>
          {adding ? "Adding…" : "Follow"}
        </Button>
      </div>

      <p className="mt-3 text-xs text-faint">
        Every incorporated town and Census place in the US — not just the metros
        above. Shows are found within a radius of the point, so a small town picks
        up whatever is listed nearby.
      </p>

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
                className="text-faint hover:text-danger"
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
