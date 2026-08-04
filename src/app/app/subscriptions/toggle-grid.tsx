"use client";

import { useState } from "react";
import { Chip, Input } from "@/components/ui";

export type ToggleItem = {
  id: number;
  label: string;
  sublabel?: string | null;
  /** True when this preference was inferred from a feed rather than chosen. */
  inferred?: boolean;
};

/**
 * Filterable grid of toggles, used for both cities and genres.
 *
 * Fully controlled and entirely synchronous. It used to call a server action on
 * every click and then `revalidatePath`, which is what produced the flicker: each
 * click round-tripped, re-rendered the server component, and the chips visibly
 * jumped as the list reflowed. Selection is now local state owned by the editor,
 * and nothing is written until Save.
 */
export function ToggleGrid({
  items,
  selected,
  onToggle,
  baseline,
  searchPlaceholder,
  emptyLabel = "Nothing matches that.",
}: {
  items: ToggleItem[];
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  /** The saved state, used to mark chips the user has changed but not saved. */
  baseline?: ReadonlySet<number>;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => item.label.toLowerCase().includes(needle))
    : items;

  return (
    <div>
      {searchPlaceholder ? (
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className="mb-4"
        />
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        // `min-h` keeps the panel from collapsing and re-expanding while the
        // search filter narrows the list, which was the other source of jumping.
        <div className="flex min-h-16 flex-wrap gap-2 [content-visibility:auto]">
          {visible.map((item) => {
            const isSelected = selected.has(item.id);
            const changed = baseline ? baseline.has(item.id) !== isSelected : false;

            return (
              <Chip
                key={item.id}
                active={isSelected}
                onClick={() => onToggle(item.id)}
                className={changed ? "ring-1 ring-pixel-3 ring-offset-0" : ""}
                title={
                  item.inferred
                    ? "Inferred from one of your feeds"
                    : changed
                      ? "Unsaved change"
                      : undefined
                }
              >
                {item.label}
                {item.sublabel ? (
                  <span className="ml-1.5 opacity-60">{item.sublabel}</span>
                ) : null}
                {item.inferred && isSelected ? (
                  <span className="ml-1.5 opacity-70">·feed</span>
                ) : null}
              </Chip>
            );
          })}
        </div>
      )}
    </div>
  );
}
