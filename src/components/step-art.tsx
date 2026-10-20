/**
 * Pixel illustrations for the three landing-page steps.
 *
 * Hand-placed rects on a 4px grid rather than an icon font or a traced image:
 * that is what keeps them genuinely pixel-art at any size, and it means they
 * inherit the site palette through CSS variables instead of shipping three more
 * files. `shapeRendering="crispEdges"` stops the browser antialiasing the block
 * edges, which is what makes a scaled-up pixel drawing look muddy.
 *
 * Purely decorative — each step's meaning is carried by its heading and text — so
 * they are hidden from assistive technology.
 */

import type { ReactNode } from "react";

const CELL = 6;

/** One block on the grid. */
function P({
  x,
  y,
  w = 1,
  h = 1,
  fill,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  fill: string;
}) {
  return (
    <rect
      x={x * CELL}
      y={y * CELL}
      width={w * CELL}
      height={h * CELL}
      fill={fill}
    />
  );
}

const ACCENT = "var(--pixel-1)";
const PINK = "var(--pixel-2)";
const CYAN = "var(--pixel-3)";
const LINE = "var(--border-strong)";
const DIM = "var(--border)";

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${CELL * 16} ${CELL * 12}`}
      width={CELL * 16}
      height={CELL * 12}
      shapeRendering="crispEdges"
      className="mb-4 block"
    >
      {children}
    </svg>
  );
}

/**
 * Step 1 — a map with a dropped pin over a block grid, i.e. picking a place.
 */
export function StepCities() {
  return (
    <Frame>
      {/* Map grid */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) =>
        [2, 3, 4, 5, 6, 7, 8, 9].map((y) => (
          <P key={`${x}-${y}`} x={x} y={y} fill={(x + y) % 2 === 0 ? DIM : "transparent"} />
        )),
      )}
      {/* Roads */}
      <P x={0} y={5} w={10} fill={LINE} />
      <P x={4} y={2} h={8} fill={LINE} />
      {/* Pin */}
      <P x={3} y={2} w={3} fill={ACCENT} />
      <P x={3} y={3} w={3} fill={ACCENT} />
      <P x={4} y={4} fill={ACCENT} />
      <P x={4} y={2} fill="var(--bg)" />
      {/* Two more places, unselected */}
      <P x={8} y={7} fill={CYAN} />
      <P x={1} y={8} fill={PINK} />
      {/* Genre chips beside the map */}
      <P x={11} y={3} w={4} fill={ACCENT} />
      <P x={11} y={5} w={3} fill={DIM} />
      <P x={11} y={7} w={4} fill={DIM} />
    </Frame>
  );
}

/**
 * Step 2 — a phone showing a list of now-playing rows: the music app screenshot.
 */
export function StepFeed() {
  return (
    <Frame>
      {/* Phone body */}
      <P x={3} y={0} w={8} h={12} fill={LINE} />
      <P x={4} y={1} w={6} h={10} fill="var(--bg)" />
      {/* Album art */}
      <P x={5} y={2} w={2} h={2} fill={ACCENT} />
      {/* Track rows */}
      <P x={8} y={2} w={2} fill={DIM} />
      <P x={8} y={3} w={1} fill={DIM} />
      <P x={5} y={5} w={1} h={1} fill={CYAN} />
      <P x={7} y={5} w={3} fill={DIM} />
      <P x={5} y={7} w={1} h={1} fill={PINK} />
      <P x={7} y={7} w={2} fill={DIM} />
      <P x={5} y={9} w={1} h={1} fill={ACCENT} />
      <P x={7} y={9} w={3} fill={DIM} />
      {/* Paste arrow leaving the phone */}
      <P x={12} y={5} w={3} fill={ACCENT} />
      <P x={14} y={4} fill={ACCENT} />
      <P x={14} y={6} fill={ACCENT} />
    </Frame>
  );
}

/**
 * Step 3 — an envelope with a pixel stamp: the Wednesday email.
 */
export function StepEmail() {
  return (
    <Frame>
      {/* Envelope */}
      <P x={1} y={2} w={14} h={8} fill={LINE} />
      <P x={2} y={3} w={12} h={6} fill="var(--bg)" />
      {/* Flap, drawn as a descending stair */}
      <P x={2} y={3} w={2} fill={LINE} />
      <P x={4} y={4} w={2} fill={LINE} />
      <P x={6} y={5} w={4} fill={LINE} />
      <P x={10} y={4} w={2} fill={LINE} />
      <P x={12} y={3} w={2} fill={LINE} />
      {/* Stamp */}
      <P x={11} y={6} w={2} h={2} fill={ACCENT} />
      <P x={12} y={7} fill={PINK} />
      {/* Lines of listings */}
      <P x={3} y={7} w={5} fill={DIM} />
      <P x={3} y={8} w={3} fill={CYAN} />
    </Frame>
  );
}
