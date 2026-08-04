/**
 * The likelylist mark, as data.
 *
 * One definition, three renderings: an inline SVG component for the app
 * (components/logo-mark.tsx), a PNG for email (scripts/build-logo.ts, because
 * Gmail does not render a mark built from table cells), and the favicon in
 * app/icon.svg. Before this module the grid was transcribed by hand into each of
 * them, which is exactly how three versions of a logo quietly stop matching.
 *
 * Read the rows as pixel art: an `L` on the left, then the two-column dotted motif
 * that the site's PixelMosaic and the digest email's PixelStrip both riff on.
 */

/** `.` is transparent; the letters index into MARK_COLORS. */
export const MARK_ROWS = [
  "Y...YP",
  "Y...BY",
  "Y...YB",
  "Y...PY",
  "YYY..B",
] as const;

export const MARK_COLS = MARK_ROWS[0].length;
export const MARK_ROWS_COUNT = MARK_ROWS.length;

/**
 * Keyed to `--pixel-1/2/3` in globals.css.
 *
 * Literal hex rather than `var(--pixel-N)` because two of the three consumers
 * cannot resolve a CSS variable: a PNG encoder has no cascade, and an email client
 * strips custom properties. The app is the odd one out in being able to, and having
 * it disagree with the other two would defeat the point of this file.
 */
export const MARK_COLORS: Record<string, string> = {
  Y: "#e4ff3f",
  P: "#ff4d6d",
  B: "#4dd8ff",
};

/**
 * Every filled cell as `{ col, row, color }`, in reading order.
 *
 * Only filled cells exist. There is deliberately no background colour anywhere in
 * this module: every rendering leaves the `.` cells transparent, so the mark sits on
 * whatever is behind it. Baking in the near-black would turn the logo into a dark
 * rectangle the moment it landed on a light surface — a mail client forcing its own
 * background, a light-themed browser tab — which looks far more broken than a
 * low-contrast mark does.
 */
export function markCells(): { col: number; row: number; color: string }[] {
  const cells: { col: number; row: number; color: string }[] = [];
  MARK_ROWS.forEach((line, row) => {
    [...line].forEach((key, col) => {
      const color = MARK_COLORS[key];
      if (color) cells.push({ col, row, color });
    });
  });
  return cells;
}
