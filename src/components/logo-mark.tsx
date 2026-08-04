import {
  MARK_COLS,
  MARK_ROWS_COUNT,
  markCells,
} from "@/lib/logo";

/**
 * The likelylist mark, as inline SVG.
 *
 * SVG rather than the PNG the emails use: on the web there is no Outlook to appease
 * and no image-blocking to design around, so vector wins outright — sharp at every
 * size and on every display, no extra request, and `shapeRendering="crispEdges"`
 * keeps the pixels from being antialiased into mush at small sizes.
 *
 * Inline rather than an <img src="/logo.svg"> so it renders in the same pass as the
 * text beside it. A separately-fetched logo in a page header is the classic source
 * of a visible pop-in on first paint.
 */
export function LogoMark({
  /** Side of one pixel cell. The mark is 6 cells wide by 5 tall. */
  cell = 4,
  className = "",
}: {
  cell?: number;
  className?: string;
}) {
  const width = MARK_COLS * cell;
  const height = MARK_ROWS_COUNT * cell;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${MARK_COLS} ${MARK_ROWS_COUNT}`}
      shapeRendering="crispEdges"
      // Decorative: the wordmark next to it already says "likelylist", so a label
      // here would just make a screen reader announce the name twice.
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {markCells().map(({ col, row, color }) => (
        <rect
          key={`${col}-${row}`}
          x={col}
          y={row}
          width={1}
          height={1}
          fill={color}
        />
      ))}
    </svg>
  );
}
