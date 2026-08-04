import type { TmAttraction, TmEvent, TmImage } from "./types";
import {
  containsTokenSequence,
  normalizeName,
  titleFragments,
} from "@/lib/normalize";

/**
 * Headliner inference.
 *
 * Ticketmaster's schema has no billing order, no role, and no headliner flag —
 * the Attraction model is exactly `type, id, locale, name, description,
 * additionalInfo, url, images, classifications, externalLinks, test, aliases,
 * localizedAliases, upcomingEvents`. Array order in `_embedded.attractions` is
 * neither documented nor guaranteed, so `attractions[0]` is not the headliner;
 * it is just whichever row came back first.
 *
 * What we can do honestly is match the performers against the event title,
 * which usually encodes the headliner ("Artist: Tour Name"). When nothing
 * matches and there is more than one performer, we return no headliner rather
 * than guessing — the UI and email then label everyone "same bill".
 */

export type ResolvedPerformer = {
  attraction: TmAttraction;
  isHeadliner: boolean;
};

/** Every name this attraction is known by, including localised aliases. */
function attractionNames(attraction: TmAttraction): string[] {
  const names = [attraction.name, ...(attraction.aliases ?? [])];
  for (const localized of Object.values(attraction.localizedAliases ?? {})) {
    names.push(...localized);
  }
  return names.filter(Boolean);
}

/**
 * How strongly this performer looks like the subject of the event title.
 *
 * Scored against every fragment of the title, not just one: "Turnstile - Never
 * Enough Tour w/ Blood Orange" yields both "Turnstile" and the full string, and
 * an exact hit on a *fragment* is much stronger evidence than a substring hit
 * on the whole title.
 */
function scoreAttraction(attraction: TmAttraction, eventName: string): number {
  const fragments = titleFragments(eventName);
  const normalizedEvent = normalizeName(eventName);

  let best = 0;
  for (const name of attractionNames(attraction)) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) continue;

    for (const fragment of fragments) {
      const isWholeTitle = normalizeName(fragment) === normalizedEvent;

      if (normalizeName(fragment) === normalizedName) {
        best = Math.max(best, isWholeTitle ? 3 : 4);
      } else if (containsTokenSequence(fragment, name)) {
        best = Math.max(best, isWholeTitle ? 1 : 2);
      }
    }
  }
  return best;
}

export function resolveLineup(event: TmEvent): ResolvedPerformer[] {
  const attractions = (event._embedded?.attractions ?? []).filter(
    (a) => !a.test,
  );
  if (attractions.length === 0) return [];

  // A single performer needs no inference — there is nothing to get wrong.
  if (attractions.length === 1) {
    return [{ attraction: attractions[0], isHeadliner: true }];
  }

  let bestIndex = -1;
  let bestScore = 0;
  let bestNameLength = 0;

  attractions.forEach((attraction, index) => {
    const score = scoreAttraction(attraction, event.name);
    if (score === 0) return;
    // On a tie prefer the more specific (longer) name: "Bad Bunny" should beat
    // "Bad" if both somehow matched.
    const nameLength = normalizeName(attraction.name).length;
    if (score > bestScore || (score === bestScore && nameLength > bestNameLength)) {
      bestIndex = index;
      bestScore = score;
      bestNameLength = nameLength;
    }
  });

  return attractions.map((attraction, index) => ({
    attraction,
    isHeadliner: index === bestIndex,
  }));
}

/**
 * Picks an image, preferring one that actually belongs to the item.
 *
 * `fallback: true` means Ticketmaster returned a generic category placeholder
 * rather than artwork, which looks broken next to real photos in an email.
 * `maxWidth` keeps email thumbnails small — the digest has a hard 100KB budget
 * before Gmail clips it.
 */
export function pickImage(
  images: TmImage[] | undefined,
  { maxWidth = 400, ratio }: { maxWidth?: number; ratio?: TmImage["ratio"] } = {},
): string | null {
  if (!images || images.length === 0) return null;

  const real = images.filter((image) => !image.fallback);
  const pool = real.length > 0 ? real : images;

  const preferred = ratio ? pool.filter((i) => i.ratio === ratio) : pool;
  const candidates = preferred.length > 0 ? preferred : pool;

  // Largest image that still fits the budget; if none fit, the smallest one.
  const withinBudget = candidates
    .filter((i) => (i.width ?? 0) <= maxWidth)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  if (withinBudget.length > 0) return toHttps(withinBudget[0].url);

  const smallest = [...candidates].sort(
    (a, b) => (a.width ?? Infinity) - (b.width ?? Infinity),
  );
  return toHttps(smallest[0].url);
}

/**
 * The docs' sample responses show `http://s1.ticketm.net/...`. An http image in
 * an email is a mixed-content warning at best and a blocked image at worst.
 */
function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, "https://");
}

/** Primary classification IDs, or nulls when the event carries none. */
export function primaryClassification(
  item: Pick<TmEvent, "classifications">,
): { segmentId: string | null; genreId: string | null; subGenreId: string | null } {
  const classifications = item.classifications ?? [];
  const primary =
    classifications.find((c) => c.primary) ?? classifications[0] ?? null;
  return {
    segmentId: primary?.segment?.id ?? null,
    genreId: primary?.genre?.id ?? null,
    subGenreId: primary?.subGenre?.id ?? null,
  };
}

/**
 * Reads a link out of the undocumented `externalLinks` map.
 *
 * Ticketmaster documents the field as `{provider: [{id?, url?}]}` but never
 * lists the provider keys and never shows a populated example, so this checks
 * several plausible spellings and tolerates the whole field being missing.
 */
export function externalLink(
  attraction: TmAttraction,
  providers: string[],
): string | null {
  const links = attraction.externalLinks;
  if (!links || typeof links !== "object") return null;

  for (const provider of providers) {
    const entries = links[provider];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry.url === "string" && entry.url) {
        return toHttps(entry.url);
      }
    }
  }
  return null;
}
