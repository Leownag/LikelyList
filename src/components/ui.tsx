import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

/* Shared chrome for the whole app. Sharp corners come from the global reset in
   globals.css, so nothing here needs to say `rounded-none`. */

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
      className={`w-full border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none ${className}`}
    />
  );
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={`w-full border border-border bg-surface-raised px-3 py-2 text-sm text-text focus:border-accent focus:outline-none ${className}`}
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
