"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Label, Notice } from "@/components/ui";
import { followArtist } from "./actions";

type Candidate = {
  tmAttractionId: string | null;
  name: string;
  imageUrl: string | null;
  tmGenreId: string | null;
};

/** Long enough that a typed name settles; short enough not to feel laggy. */
const DEBOUNCE_MS = 350;

/**
 * Follow an artist by name.
 *
 * Candidates come from Ticketmaster rather than being free text, because a follow
 * only ever matches an event if its normalised name matches what Ticketmaster puts
 * in a lineup — so a name the API does not know is a follow that silently never
 * fires. Showing the candidates also lets a person do the one disambiguation a
 * scorer cannot: telling a band apart from its tribute act.
 *
 * Every request costs Ticketmaster quota, so the search is debounced and only runs
 * from two characters up (their `keyword` does not match partial words anyway).
 */
export function ArtistSearch() {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Guards against a slow earlier response overwriting a newer one.
  const requestId = useRef(0);

  // Clearing lives here rather than in the effect: the state change belongs to the
  // keystroke that caused it, and an effect that calls setState synchronously is
  // both a lint error and a wasted render.
  function changeQuery(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      // Cancels any in-flight search so a late response cannot repopulate a list
      // the reader has just cleared.
      requestId.current += 1;
      setCandidates(null);
      setError(null);
      setSearching(false);
    }
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await fetch("/api/artists/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
        });
        const payload = (await response.json()) as {
          artists?: Candidate[];
          error?: string;
        };

        if (id !== requestId.current) return;

        if (!response.ok) {
          setError(payload.error ?? "That search didn't go through.");
          setCandidates(null);
          return;
        }
        setCandidates(payload.artists ?? []);
      } catch {
        if (id === requestId.current) {
          setError("Could not reach the server. Check your connection.");
        }
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  function follow(candidate: Candidate) {
    // Cancels any in-flight search so its result cannot repopulate the list
    // underneath the confirmation.
    requestId.current += 1;
    setQuery("");
    setCandidates(null);
    setError(null);

    startTransition(async () => {
      try {
        await followArtist({
          name: candidate.name,
          tmAttractionId: candidate.tmAttractionId,
        });
        setAdded((current) => [candidate.name, ...current]);
      } catch {
        setError(`Could not follow ${candidate.name}. Try again.`);
      }
    });
  }

  return (
    <div className="mb-4">
      <Label htmlFor="artist-search">Follow an artist</Label>
      <Input
        id="artist-search"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => changeQuery(event.target.value)}
        placeholder="The band you don't want to miss again"
        aria-describedby="artist-search-hint"
      />
      <p id="artist-search-hint" className="mt-1.5 text-xs text-faint">
        {searching
          ? "Searching Ticketmaster…"
          : "Two characters or more. Shows by anyone you follow get pushed to the top of your digest, even in a genre you don't follow."}
      </p>

      {error ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      {candidates !== null && candidates.length === 0 && !searching ? (
        <p className="mt-3 text-xs text-muted">
          Ticketmaster has no music act by that name. It matches whole words only,
          so try the full spelling.
        </p>
      ) : null}

      {candidates !== null && candidates.length > 0 ? (
        <ul className="mt-3 divide-y divide-border border border-border">
          {candidates.map((candidate) => (
            <li
              key={`${candidate.tmAttractionId ?? candidate.name}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-sm text-text">{candidate.name}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => follow(candidate)}
                className="shrink-0 border border-border-strong px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50"
              >
                Follow
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {added.length > 0 ? (
        <p className="mt-3 text-xs text-accent" aria-live="polite">
          Now following {added.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
