import Link from "next/link";
import { LogoMark } from "./logo-mark";

/**
 * The logo lockup: the pixel mark, then the name.
 *
 * The mark previously existed only as a favicon and inside the digest email, while
 * the site showed the name and a single trailing dot. Now both wear the same face —
 * the mark is what someone will recognise in a crowded inbox, so the site should not
 * be the one place it is missing.
 *
 * Sized in whole pixel cells per step rather than scaled off the font size, because
 * a fractional cell is exactly what makes pixel art look blurry.
 */
const CELL: Record<"sm" | "md" | "lg", number> = {
  sm: 3,
  md: 4,
  lg: 6,
};

export function Wordmark({
  href = "/",
  size = "md",
}: {
  href?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const text =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-xl";

  const inner = (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark cell={CELL[size]} />
      <span className={`font-pixel ${text} tracking-tight text-text`}>
        likelylist
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="inline-flex hover:opacity-80">
      {inner}
    </Link>
  );
}
