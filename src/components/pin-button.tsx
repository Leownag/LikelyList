"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { pinEvent, unpinEvent } from "@/app/app/pinned/actions";
import type { PinInput } from "@/lib/pins/types";

/**
 * Pin or unpin one event.
 *
 * Optimistic: the label flips immediately and reverts if the action throws. A pin is a
 * low-stakes, high-frequency click — somebody going down a list of ninety shows — and
 * a spinner on each one would make the list feel broken.
 *
 * Rendered as nothing when there is no signed-in reader, rather than as a button that
 * bounces to /login. Somebody browsing /explore without an account is there precisely
 * because they have not committed to one, and a row of dead buttons is a worse answer
 * than no buttons.
 */
export function PinButton({
  event,
  initiallyPinned,
  signedIn,
}: {
  event: PinInput;
  initiallyPinned: boolean;
  signedIn: boolean;
}) {
  const t = useT();
  const [pinned, setPinned] = useState(initiallyPinned);
  const [pending, startTransition] = useTransition();

  if (!signedIn) return null;

  function toggle() {
    const next = !pinned;
    setPinned(next);

    startTransition(async () => {
      try {
        if (next) await pinEvent(event);
        else await unpinEvent(event.tmEventId);
      } catch {
        // Put it back. Without this the button lies about what the server holds, and
        // the reader finds out when the Pinned page disagrees.
        setPinned(!next);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={pinned}
      title={pinned ? t("card.unpin.title") : t("card.pin.title")}
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs transition-colors ${
        pending ? "opacity-70" : ""
      } ${
        pinned
          ? "border-accent bg-accent text-accent-ink"
          : "border-border-strong text-muted hover:border-accent hover:text-text"
      }`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        aria-hidden="true"
        className="shrink-0"
        fill={pinned ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
      >
        {/* A pushpin, drawn on the same pixel grid as the rest of the site. */}
        <path d="M4 0.6h3v3l1.6 2H2.4L4 3.6z" />
        <path d="M5.5 5.6v4.8" />
      </svg>
      {pinned ? t("card.pinned") : t("card.pin")}
    </button>
  );
}
