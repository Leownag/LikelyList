"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

/**
 * The /app section nav.
 *
 * A client component for one reason: it needs the current path to say where the
 * reader is. Every link used to carry an identical class string, so the nav
 * answered "where can I go" but never "where am I" — the only way to tell which
 * section you were in was the browser tab title.
 *
 * Labels arrive already translated. The layout is a server component and holds
 * the translator, so passing strings keeps the message catalogue out of the
 * client bundle.
 */
export function AppNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="mt-8 flex flex-wrap gap-1">
      {items.map((item) => {
        // "/app" is a prefix of every other entry, so it alone has to match
        // exactly — otherwise the overview reads as current on all five pages.
        const current =
          item.href === "/app"
            ? pathname === "/app"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            // Same two cues as the language switcher, which is the one place in
            // the app that already had a current state: an accent border and
            // full-strength text, so it does not rest on colour alone.
            className={
              current
                ? "border border-accent px-3 py-1.5 text-sm text-text"
                : "border border-transparent px-3 py-1.5 text-sm text-muted hover:border-border hover:text-text"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
