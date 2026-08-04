"use client";

import { useState, useTransition } from "react";
import { Card, EmptyState } from "@/components/ui";
import { removeArtistPref } from "./actions";

type ArtistPrefRow = {
  id: number;
  name: string;
  score: number;
  source: string;
  last_seen_at: string;
};

export function ArtistPrefList({ artists }: { artists: ArtistPrefRow[] }) {
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();

  const visible = artists.filter((artist) => !removed.has(artist.id));

  function remove(id: number) {
    setRemoved((current) => new Set(current).add(id));
    startTransition(async () => {
      try {
        await removeArtistPref(id);
      } catch {
        setRemoved((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    });
  }

  if (visible.length === 0) {
    return (
      <EmptyState title="no artists learned yet">
        Paste a show flyer on the Feeds page and the artists on it will show up
        here.
      </EmptyState>
    );
  }

  return (
    <Card className="p-5">
      <ul
        className={`flex flex-wrap gap-2 ${pending ? "opacity-80" : ""}`}
        aria-busy={pending}
      >
        {visible.map((artist) => (
          <li
            key={artist.id}
            className="flex items-center gap-2 border border-border bg-surface-raised px-3 py-1.5 text-xs"
          >
            <span className="text-text">{artist.name}</span>
            <span className="font-mono text-faint" title="Interest score">
              {artist.score.toFixed(1)}
            </span>
            <button
              type="button"
              onClick={() => remove(artist.id)}
              className="text-faint hover:text-danger"
              aria-label={`Stop following ${artist.name}`}
              title={`Stop following ${artist.name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
