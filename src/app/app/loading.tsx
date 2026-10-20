import { getT } from "@/lib/i18n/server";

/**
 * Shown while an /app page's server render is in flight.
 *
 * Every page in this section re-verifies the session and then runs several
 * Supabase queries before it can render anything. Without this file Next holds
 * the *previous* page on screen for the whole round trip, so clicking a nav link
 * looked like nothing had happened — the commonest report was that the nav was
 * broken.
 *
 * Shaped like the pages rather than being a spinner: a heading, a hint line and
 * a pair of cards is roughly what every section here opens with, so the layout
 * does not jump when the real content lands.
 */
export default async function AppLoading() {
  const t = await getT();

  return (
    <div
      className="space-y-10"
      role="status"
      aria-label={t("shell.loading")}
      // A stable hook for the UI walk, which otherwise reads this skeleton and
      // believes it is the page. Same convention as data-empty elsewhere.
      data-loading="app"
    >
      <section className="animate-pulse">
        <div className="mb-4">
          <div className="h-5 w-40 bg-surface-raised" />
          <div className="mt-2 h-3 w-64 bg-surface" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="border border-border bg-surface p-5">
              <div className="h-3 w-24 bg-surface-raised" />
              <div className="mt-4 h-3 w-full bg-surface-raised" />
              <div className="mt-2 h-3 w-5/6 bg-surface-raised" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
