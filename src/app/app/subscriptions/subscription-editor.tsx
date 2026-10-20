"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice, SectionHeading } from "@/components/ui";
import { PixelDot } from "@/components/pixel";
import { artistSelectionDelta } from "@/lib/artist-score";
import { saveSelections } from "./actions";
import { ToggleGrid, type ToggleItem } from "./toggle-grid";

/**
 * Artists, cities and genres, edited together and saved once.
 *
 * The whole selection lives in local state until Save. That removes the flicker
 * from the old design (a server action plus revalidate on every chip) and, more
 * importantly, makes the screen behave the way a settings screen should: change
 * several things, look at them, then commit or walk away.
 *
 * Cities and genres are held as absolute sets; artists are held as *intent* — see
 * artistIntent below. The asymmetry is deliberate and load-bearing.
 */
export function SubscriptionEditor({
  cities,
  genres,
  artists,
  savedCityIds,
  savedGenreIds,
  savedArtistIds,
  inferredGenreIds,
  placesControl,
  artistsControl,
}: {
  cities: ToggleItem[];
  genres: ToggleItem[];
  artists: ToggleItem[];
  savedCityIds: number[];
  savedGenreIds: number[];
  savedArtistIds: number[];
  inferredGenreIds: number[];
  /**
   * The follow-any-town control, rendered under the grid.
   *
   * Passed in rather than imported: it writes immediately and this component's whole
   * job is to hold edits until Save, so it stays out of the dirty tracking above.
   */
  placesControl?: ReactNode;
  /** The search box and Spotify card. Same reason as placesControl: they write on click. */
  artistsControl?: ReactNode;
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

  /**
   * What the reader has changed about the artists, not which artists are on.
   *
   * Three things write artist_prefs behind this component's back — the search box, the
   * Spotify card, and a screenshot confirm — and each one refreshes the page, so the
   * saved-ids prop changes mid-edit. An absolute Set seeded from props would either
   * ignore the new row or throw away pending edits. Intent has neither problem: an
   * artist nobody touched has no entry, so it simply follows the server.
   *
   * It also means save() resets nothing. Once the refresh lands, intent agrees with the
   * server, the delta empties and `dirty` goes false on its own — where clearing a set
   * by hand would flicker in the window before the refresh arrives.
   */
  const savedArtists = useMemo(() => new Set(savedArtistIds), [savedArtistIds]);
  const [artistIntent, setArtistIntent] = useState<Map<number, boolean>>(new Map());

  const checkedArtists = useMemo(() => {
    const next = new Set(savedArtists);
    for (const [id, on] of artistIntent) {
      if (on) next.add(id);
      else next.delete(id);
    }
    return next;
  }, [savedArtists, artistIntent]);

  const artistDelta = artistSelectionDelta(
    artists.map((artist) => artist.id),
    savedArtists,
    artistIntent,
  );

  const dirty =
    !sameSet(cityIds, savedCities) ||
    !sameSet(genreIds, savedGenres) ||
    artistDelta.on.length + artistDelta.off.length > 0;

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

  function toggleArtist(id: number) {
    const next = new Map(artistIntent);
    next.set(id, !checkedArtists.has(id));
    setArtistIntent(next);
    setSaved(false);
    setError(null);
  }

  function setAllArtists(on: boolean) {
    const next = new Map(artistIntent);
    for (const artist of artists) next.set(artist.id, on);
    setArtistIntent(next);
    setSaved(false);
    setError(null);
  }

  // `every` rather than comparing sizes: a saved id with no row on screen — truncated by
  // the query's limit — would otherwise wedge this permanently at "Clear all".
  const allArtistsChecked =
    artists.length > 0 && artists.every((artist) => checkedArtists.has(artist.id));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveSelections({
        cityIds: [...cityIds],
        genreIds: [...genreIds],
        artistsOn: artistDelta.on,
        artistsOff: artistDelta.off,
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

  // Discards in place rather than navigating. It used to also push to /app,
  // so a button labelled "Back without saving" both threw away the edits and
  // moved the reader to a different page — only one of which the label named,
  // and the page it chose was not the one they came from.
  function discard() {
    setCityIds(new Set(savedCities));
    setGenreIds(new Set(savedGenres));
    setArtistIntent(new Map());
    setSaved(false);
    setError(null);
  }

  const genreItems = genres.map((genre) => ({
    ...genre,
    inferred: inferred.has(genre.id),
  }));

  return (
    <div className="space-y-8">
      {/* scroll-mt clears the sticky SectionNav, which would otherwise cover the
          heading a jump link just moved to. */}
      <section id="artists" className="scroll-mt-16">
        <SectionHeading hint="Search for anyone you don't want to miss, or let a screenshot fill this in. Shows by these artists get pushed to the top of your digest — and reach it even in a genre you don't follow.">
          Artists
        </SectionHeading>

        {artistsControl}

        <Card className="p-5">
          <ToggleGrid
            checkbox
            items={artists}
            selected={checkedArtists}
            baseline={savedArtists}
            onToggle={toggleArtist}
            emptyLabel="Nobody yet — search above, or add a screenshot at the bottom of this page."
          />

          {artists.length > 0 ? (
            <button
              type="button"
              className="mt-4 text-xs text-accent underline"
              onClick={() => setAllArtists(!allArtistsChecked)}
            >
              {allArtistsChecked ? "Clear all" : "Select all"}
            </button>
          ) : null}

          <p className="mt-4 text-xs text-faint">
            Unticking keeps the name here rather than deleting it, so a screenshot or a
            Spotify sync will not quietly tick it again.
          </p>
        </Card>
      </section>

      <section id="cities" className="scroll-mt-16">
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

        {placesControl ? <div className="mt-4">{placesControl}</div> : null}
      </section>

      <section id="genres" className="scroll-mt-16">
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
          <Button variant="ghost" onClick={discard} disabled={busy || !dirty}>
            Discard changes
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
              `${cityIds.size} cit${cityIds.size === 1 ? "y" : "ies"} · ${genreIds.size} genre${genreIds.size === 1 ? "" : "s"} · ${checkedArtists.size} artist${checkedArtists.size === 1 ? "" : "s"}`
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
