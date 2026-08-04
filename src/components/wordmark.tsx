import Link from "next/link";
import { PixelDot } from "./pixel";

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
    <span className="inline-flex items-baseline gap-2">
      <span className={`font-pixel ${text} tracking-tight text-text`}>
        likelylist
      </span>
      <PixelDot size={size === "lg" ? 10 : 6} />
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="inline-flex hover:opacity-80">
      {inner}
    </Link>
  );
}
