"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildIcs,
  googleCalendarUrl,
  icsFileName,
  type CalendarEvent,
} from "@/lib/calendar";
import { ASSET_SRC, serviceLabel } from "@/components/service-icon";

/**
 * Add to calendar, self-hosted.
 *
 * Modelled on what AddEvent's widget does — one button, a small menu of destinations —
 * and deliberately not using it. A hosted widget means a third-party script on the page
 * that learns which shows a reader is interested in, to save a URL and a text file.
 *
 * Google is a link. Apple is a generated `.ics` handed over as a Blob rather than
 * fetched from a route: the file is a few hundred bytes derived from data already on
 * the page, so a round trip would add a failure mode and a URL long enough to hit
 * length limits, and buy nothing.
 */
export function AddToCalendar({
  event,
  className = "",
}: {
  event: CalendarEvent;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. A menu that only closes by choosing something
  // is the kind of thing that traps a reader on a phone.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(pointer: MouseEvent | TouchEvent) {
      if (!container.current?.contains(pointer.target as Node)) setOpen(false);
    }
    function onKeyDown(key: KeyboardEvent) {
      if (key.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const google = googleCalendarUrl(event);

  function downloadIcs() {
    const ics = buildIcs(event);
    if (!ics) return;

    // `text/calendar` rather than octet-stream, so a phone offers to open it in the
    // calendar instead of just filing it away.
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = href;
    link.download = icsFileName(event);
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Revoked on the next tick rather than immediately: revoking before the browser
    // has started reading the blob cancels the download in Safari.
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setOpen(false);
  }

  // No parseable date means no calendar entry to offer. Hiding the button beats
  // offering one that silently does nothing.
  if (!google) return null;

  return (
    <div ref={container} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 border border-border-strong px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text"
      >
        {/* An outline glyph, not a brand mark — this button is ours. */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect x="0.6" y="1.6" width="10.8" height="9.8" />
          <path d="M0.6 4.4h10.8M3.4 1.6V0.6M8.6 1.6V0.6" />
        </svg>
        Add to calendar
      </button>

      {open ? (
        <ul
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-52 border border-border-strong bg-surface-raised shadow-lg"
        >
          <li role="none">
            <a
              role="menuitem"
              href={google}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-surface"
            >
              <BrandGlyph service="google" />
              {serviceLabel("google")}
            </a>
          </li>
          <li role="none">
            <button
              role="menuitem"
              type="button"
              onClick={downloadIcs}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
            >
              <BrandGlyph service="apple" />
              {serviceLabel("apple")}
            </button>
          </li>
          <li className="border-t border-border px-3 py-2 text-xs text-faint">
            Apple downloads a .ics file, which also works in Outlook and Fantastical.
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The official mark, or nothing.
 *
 * Same degradation as ServiceLink: until the asset is in public/brand/ this renders
 * nothing rather than a broken image, and the text label beside it carries the meaning
 * on its own. Deliberately not a redrawn logo — both companies forbid that.
 */
function BrandGlyph({ service }: { service: "google" | "apple" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ASSET_SRC[service]}
      alt=""
      aria-hidden="true"
      width={14}
      height={14}
      className="shrink-0"
      style={{ objectFit: "contain" }}
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}
