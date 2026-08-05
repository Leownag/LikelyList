/**
 * Jump links for a page that is now four screens tall.
 *
 * Plain anchors and `scroll-mt-*` on the targets — no JS, no scroll listener, no active
 * highlighting. The browser already does smooth scrolling, back-button history and
 * keyboard focus for `#fragment` links, and reimplementing that to draw one chip in a
 * different colour is a lot of client code for a decoration.
 *
 * Sticky, because the point is to move between sections from wherever you are.
 */
const SECTIONS = [
  { id: "artists", label: "Artists" },
  { id: "cities", label: "Cities" },
  { id: "genres", label: "Genres" },
  { id: "screenshots", label: "Screenshots" },
] as const;

export function SectionNav() {
  return (
    <nav
      aria-label="Jump to a section"
      className="sticky top-0 z-20 -mx-6 flex flex-wrap gap-1 border-b border-border bg-bg/95 px-6 py-3 backdrop-blur"
    >
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-text"
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
