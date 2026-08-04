/**
 * Name normalisation, shared by Ticketmaster matching, feed extraction and
 * preference keys.
 *
 * The same artist arrives spelled several ways — "Sigur Rós" from a poster,
 * "Sigur Ros" from Ticketmaster, "SIGUR ROS" from a Spotify screenshot — and
 * these all have to collapse to one preference row.
 */

/** Lowercased, unaccented, punctuation-free, single-spaced. */
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    // Strip the combining marks the decomposition leaves behind, so "Sigur Rós"
    // and "Sigur Ros" collapse to the same key.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalised tokens, for word-boundary-aware comparisons. */
export function tokens(input: string): string[] {
  const normalized = normalizeName(input);
  return normalized ? normalized.split(" ") : [];
}

/** True when `needle`'s tokens appear consecutively inside `haystack`'s. */
export function containsTokenSequence(
  haystack: string,
  needle: string,
): boolean {
  const hay = tokens(haystack);
  const need = tokens(needle);
  if (need.length === 0 || need.length > hay.length) return false;

  for (let i = 0; i <= hay.length - need.length; i++) {
    let match = true;
    for (let j = 0; j < need.length; j++) {
      if (hay[i + j] !== need[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Splits an event title into the fragments most likely to be the artist name.
 *
 * Ticketmaster event names very often encode the headliner as a prefix —
 * "Radiohead: In Rainbows Tour", "Turnstile - Never Enough" — so the prefix is
 * a much stronger signal than the whole string.
 */
export function titleFragments(eventName: string): string[] {
  const fragments = new Set<string>([eventName]);

  const separators = [
    ":",
    " - ",
    " – ",
    " — ",
    " | ",
    " w/ ",
    " with ",
    " featuring ",
    " feat. ",
    " live at ",
    " at ",
  ];

  for (const separator of separators) {
    const index = eventName.toLowerCase().indexOf(separator);
    if (index > 0) fragments.add(eventName.slice(0, index));
  }

  return [...fragments].map((f) => f.trim()).filter(Boolean);
}
