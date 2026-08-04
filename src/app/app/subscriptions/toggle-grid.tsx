"use client";

import { useState, useTransition } from "react";
import { Chip, Input } from "@/components/ui";

export type ToggleItem = {
  id: number;
  label: string;
  sublabel?: string | null;
  active: boolean;
  /** Set when this preference was inferred from a feed rather than chosen. */
  inferred?: boolean;
};

/**
 * Filterable grid of toggles, used for both cities and genres.
 *
 * Optimistic: the chip flips immediately and reverts if the action throws.
 * There are ~40 cities and ~20 genres, so waiting for a round trip per click
 * would make picking a handful feel broken.
 */
export function ToggleGrid({
  items,
  onToggle,
  searchPlaceholder,
  emptyLabel = "Nothing matches that.",
}: {
  items: ToggleItem[];
  onToggle: (id: number) => Promise<void>;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => item.label.toLowerCase().includes(needle))
    : items;

  function isActive(item: ToggleItem) {
    return optimistic[item.id] ?? item.active;
  }

  function handleToggle(item: ToggleItem) {
    const next = !isActive(item);
    setOptimistic((current) => ({ ...current, [item.id]: next }));
    setError(null);

    startTransition(async () => {
      try {
        await onToggle(item.id);
        // Clear the override so the server's value is authoritative again.
        setOptimistic((current) => {
          const rest = { ...current };
          delete rest[item.id];
          return rest;
        });
      } catch {
        setOptimistic((current) => ({ ...current, [item.id]: !next }));
        setError("That didn't save. Check your connection and try again.");
      }
    });
  }

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

      {error ? <p className="mb-3 text-xs text-danger">{error}</p> : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div
          className={`flex flex-wrap gap-2 ${pending ? "opacity-80" : ""}`}
          aria-busy={pending}
        >
          {visible.map((item) => (
            <Chip
              key={item.id}
              active={isActive(item)}
              onClick={() => handleToggle(item)}
              title={item.inferred ? "Inferred from one of your feeds" : undefined}
            >
              {item.label}
              {item.sublabel ? (
                <span className="ml-1.5 opacity-60">{item.sublabel}</span>
              ) : null}
              {item.inferred && isActive(item) ? (
                <span className="ml-1.5 opacity-70">·feed</span>
              ) : null}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
