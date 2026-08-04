/**
 * Pixel-block decoration.
 *
 * The block pattern is derived from a string seed with a small deterministic
 * hash rather than Math.random(). That matters: these render on the server and
 * hydrate on the client, and a random pattern would differ between the two and
 * trip a hydration mismatch.
 */

const PALETTE = ["var(--pixel-1)", "var(--pixel-2)", "var(--pixel-3)"] as const;

/** xorshift-ish 32-bit PRNG. Same seed always yields the same sequence. */
function seededSequence(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    out.push(Math.abs(h) / 2147483647);
  }
  return out;
}

export function PixelMosaic({
  seed,
  cols = 8,
  rows = 8,
  cell = 8,
  density = 0.35,
  className = "",
}: {
  seed: string;
  cols?: number;
  rows?: number;
  cell?: number;
  /** Fraction of cells that get filled. The rest stay transparent. */
  density?: number;
  className?: string;
}) {
  const values = seededSequence(seed, cols * rows * 2);

  return (
    <div
      aria-hidden="true"
      className={`grid shrink-0 ${className}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
        gridTemplateRows: `repeat(${rows}, ${cell}px)`,
        imageRendering: "pixelated",
      }}
    >
      {Array.from({ length: cols * rows }, (_, i) => {
        const filled = values[i] < density;
        const hue = PALETTE[Math.floor(values[i + cols * rows] * PALETTE.length)];
        return (
          <span
            key={i}
            style={{
              width: cell,
              height: cell,
              background: filled ? hue : "transparent",
            }}
          />
        );
      })}
    </div>
  );
}

/** A single 8px square. Handy as a bullet or inline marker. */
export function PixelDot({
  color = "var(--accent)",
  size = 8,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0"
      style={{ width: size, height: size, background: color }}
    />
  );
}

/** Horizontal rule drawn as a dashed row of blocks instead of a line. */
export function PixelRule({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-[2px] w-full ${className}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(to right, var(--border-strong) 0 4px, transparent 4px 8px)",
      }}
    />
  );
}
