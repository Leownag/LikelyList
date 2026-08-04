"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice, SectionHeading } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import { saveSelections } from "./actions";
import { ToggleGrid, type ToggleItem } from "./toggle-grid";

/**
 * Cities and genres, edited together and saved once.
 *
 * The whole selection lives in local state until Save. That removes the flicker
 * from the old design (a server action plus revalidate on every chip) and, more
 * importantly, makes the screen behave the way a settings screen should: change
 * several things, look at them, then commit or walk away.
 */
export function SubscriptionEditor({
  cities,
  genres,
  savedCityIds,
  savedGenreIds,
  inferredGenreIds,
}: {
  cities: ToggleItem[];
  genres: ToggleItem[];
  savedCityIds: number[];
  savedGenreIds: number[];
  inferredGenreIds: number[];
}) {
  const router = useRouter();

  const savedCities = useMemo(() => new Set(savedCityIds), [savedCityIds]);
  const savedGenres = useMemo(() => new Set(savedGenreIds), [savedGenreIds]);
  const inferred = useMemo(() => new Set(inferredGenreIds), [inferredGenreIds]);

  const [cityIds, setCityIds] = useState<Set<number>>(() => new Set(savedCityIds));
  const [genreIds, setGenreIds] = useState<Set<number>>(() => new Set(savedGenreIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    !sameSet(cityIds, savedCities) || !sameSet(genreIds, savedGenres);

  // A hard navigation or tab close with pending edits should not silently drop
  // them. In-app navigation is covered by the visible Save / Discard pair.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function toggle(set: Set<number>, setter: (next: Set<number>) => void, id: number) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
    setSaved(false);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveSelections({
        cityIds: [...cityIds],
        genreIds: [...genreIds],
      });
      setSaved(true);
      // Refresh so the server-rendered summary and the /app overview agree with
      // what was just written.
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function discardAndLeave() {
    setCityIds(new Set(savedCities));
    setGenreIds(new Set(savedGenres));
    router.push("/app");
  }

  const genreItems = genres.map((genre) => ({
    ...genre,
    inferred: inferred.has(genre.id),
  }));

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading hint="One Ticketmaster query is made per city you follow, shared across everyone who follows it.">
          Cities
        </SectionHeading>
        <Card className="p-5">
          <ToggleGrid
            items={cities}
            selected={cityIds}
            baseline={savedCities}
            onToggle={(id) => toggle(cityIds, setCityIds, id)}
            searchPlaceholder="Filter cities…"
          />
          <p className="mt-4 text-xs text-faint">
            United States only. Listings outside the US come from a separate, much
            thinner Ticketmaster API that carries no genre IDs, so adding them
            would mean filtering a different way.
          </p>
        </Card>
      </section>

      <section>
        <SectionHeading hint="Ordered roughly by how much is listed in each, not alphabetically. Filtering happens on each event's primary Ticketmaster genre.">
          Genres
        </SectionHeading>
        <Card className="p-5">
          <ToggleGrid
            items={genreItems}
            selected={genreIds}
            baseline={savedGenres}
            onToggle={(id) => toggle(genreIds, setGenreIds, id)}
            searchPlaceholder="Filter genres…"
          />
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-faint">
            <span className="flex items-center gap-1.5">
              <PixelDot size={6} color="var(--pixel-1)" /> selected
            </span>
            <span className="flex items-center gap-1.5">
              <PixelDot size={6} color="var(--pixel-3)" /> unsaved change
            </span>
            <span>·feed = inferred from a screenshot you added</span>
          </div>
        </Card>
      </section>

      {/* Sticky so the controls stay reachable without scrolling back up after
          working through a long list. */}
      <div className="sticky bottom-0 -mx-6 border-t border-border bg-bg/95 px-6 py-4 backdrop-blur">
        {error ? (
          <div className="mb-3">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={discardAndLeave} disabled={busy}>
            Back without saving
          </Button>

          <span className="text-xs text-faint">
            {dirty ? (
              <span className="flex items-center gap-1.5 text-pixel-3">
                <PixelDot size={6} color="var(--pixel-3)" />
                unsaved changes
              </span>
            ) : saved ? (
              "Saved."
            ) : (
              `${cityIds.size} cit${cityIds.size === 1 ? "y" : "ies"} · ${genreIds.size} genre${genreIds.size === 1 ? "" : "s"}`
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
