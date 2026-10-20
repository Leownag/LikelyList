import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

/* Shared chrome for the whole app. Sharp corners come from the global reset in
   globals.css, so nothing here needs to say `rounded-none`. */

/* Form controls are text-base below `sm` and text-sm above. iOS Safari zooms the
   page when a control under 16px takes focus, and it does not zoom back out.

   They also do NOT set focus:outline-none. The accent border on focus reads as a
   focus state to someone using a mouse, but suppressing the outline suppressed it
   for keyboard users too — and the global :focus-visible rule in globals.css was
   the only focus affordance those three fields had. */

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const BUTTON_VARIANTS = {
  primary: "bg-accent text-accent-ink hover:bg-white",
  outline:
    "border border-border-strong bg-transparent text-text hover:border-accent hover:text-accent",
  ghost: "bg-transparent text-muted hover:text-text",
  danger:
    "border border-danger/50 bg-transparent text-danger hover:bg-danger hover:text-bg",
} as const;

type Variant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      {...props}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={`border border-border bg-surface ${className}`}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="label-pixel block mb-2">
      {children}
    </label>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={`w-full border border-border bg-surface-raised px-3 py-2 text-base text-text placeholder:text-faint focus:border-accent sm:text-sm ${className}`}
    />
  );
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={`w-full border border-border bg-surface-raised px-3 py-2 text-base text-text focus:border-accent sm:text-sm ${className}`}
    />
  );
}

/** Toggleable tag, used for city and genre selection. */
export function Chip({
  active,
  className = "",
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      {...props}
      aria-pressed={active}
      className={`border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-accent bg-accent text-accent-ink"
          : "border-border bg-surface-raised text-muted hover:border-border-strong hover:text-text"
      } ${className}`}
    />
  );
}

export function SectionHeading({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  const border =
    tone === "error"
      ? "border-l-danger"
      : tone === "warn"
        ? "border-l-pixel-3"
        : tone === "success"
          ? "border-l-accent"
          : "border-l-border-strong";
  return (
    <div
      className={`border border-border border-l-2 ${border} bg-surface px-4 py-3 text-sm text-muted`}
    >
      {children}
    </div>
  );
}

/**
 * The result of something the reader just did, said where they did it.
 *
 * This component is new because the app had nothing of the kind, which is why
 * saving your settings, following a town, disconnecting Spotify and a failed pin
 * were all completely silent — not an oversight in each place, just nothing to
 * reach for. ArtistSearch had grown its own one-off version; this is that,
 * generalised.
 *
 * Inline rather than a floating toast on purpose. What readers reported missing
 * was not a notification but legibility: where a pinned show went, why a button
 * was disabled, whether a save landed. An answer that drifts away after three
 * seconds does not help with any of those, and it is the harder thing for
 * assistive tech to catch.
 *
 * `role="status"` makes it an assertive-enough live region that a screen reader
 * announces it without interrupting, which is the right level for "Saved."
 */
export function StatusLine({
  tone = "success",
  children,
}: {
  tone?: "success" | "error";
  children?: ReactNode;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      // Always rendered, even with nothing to say: a live region that appears
      // only when it has content is announced inconsistently across readers.
      className={`text-xs ${tone === "error" ? "text-danger" : "text-muted"}`}
    >
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-border px-6 py-10 text-center">
      <p className="label-pixel">{title}</p>
      {children ? (
        <div className="mt-3 text-sm text-muted">{children}</div>
      ) : null}
    </div>
  );
}
