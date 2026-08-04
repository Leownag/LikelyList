import { ButtonLink } from "@/components/ui";
import { PixelMosaic, PixelRule } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEnv } from "@/lib/env";
import type { City, Genre } from "@/lib/db";
import { ExploreClient } from "./explore-client";
import type { SubscribeCity, SubscribeGenre } from "@/components/anonymous-subscribe";

/** Same reason as the landing page: the city and genre lists come from the
 *  database, so prerendering would freeze them at build time. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Explore this week — likelylist",
  description:
    "Browse the coming week's shows by city or ZIP code, filtered by genre. No account needed.",
};

export default async function ExplorePage() {
  const { cities, genres } = await loadPickers();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Wordmark />
        {/* The subscribe box lives at the bottom of the results, attached to a
            search someone has actually looked at, which is a better moment to ask
            for an address than the top of an empty page. */}
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">
            Sign in
          </ButtonLink>
        </nav>
      </header>

      <section className="mt-14 flex items-start justify-between gap-8">
        <div className="max-w-xl">
          <p className="label-pixel">no account needed</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
            What&apos;s on this week
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Pick a city or type a ZIP code, narrow it by genre, and see the next
            seven days. Nothing is emailed, nothing is saved — this is just the
            same data the Friday digest is built from.
          </p>
        </div>
        <PixelMosaic
          seed="likelylist-explore"
          cols={6}
          rows={7}
          cell={10}
          density={0.3}
          className="hidden sm:grid"
        />
      </section>

      <PixelRule className="mt-8" />

      <div className="mt-8">
        {cities.length === 0 ? (
          <p className="text-sm text-muted">
            Search isn&apos;t available yet — the city and genre tables have not been
            seeded on this deployment.
          </p>
        ) : (
          <ExploreClient cities={cities} genres={genres} />
        )}
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-16 text-xs text-faint">
        <span className="flex flex-wrap items-center gap-4">
          <Wordmark href="/" size="sm" />
          <a className="underline hover:text-muted" href="/privacy">
            Privacy
          </a>
        </span>
        <p>
          Event data via Ticketmaster. Video links via YouTube (
          <a
            className="underline hover:text-muted"
            href="https://www.youtube.com/t/terms"
            rel="noreferrer noopener"
            target="_blank"
          >
            terms
          </a>
          ).
        </p>
      </footer>
    </main>
  );
}

/** Same defensive load as the landing page — a missing table degrades, not throws. */
async function loadPickers(): Promise<{
  cities: SubscribeCity[];
  genres: SubscribeGenre[];
}> {
  try {
    const env = readEnv();
    if (!env.supabaseServiceRoleKey) return { cities: [], genres: [] };

    const supabase = createAdminClient(env);
    const [citiesResult, genresResult] = await Promise.all([
      supabase
        .from("cities")
        .select("slug, name, state_code, latitude, longitude")
        .order("sort_order"),
      supabase.from("genres").select("id, name").order("sort_order"),
    ]);

    return {
      cities: (
        (citiesResult.data ?? []) as Pick<
          City,
          "slug" | "name" | "state_code" | "latitude" | "longitude"
        >[]
      ).map((city) => ({
        slug: city.slug,
        name: city.name,
        stateCode: city.state_code,
        latitude: city.latitude,
        longitude: city.longitude,
      })),
      genres: ((genresResult.data ?? []) as Pick<Genre, "id" | "name">[]).map(
        (genre) => ({ id: genre.id, name: genre.name }),
      ),
    };
  } catch {
    return { cities: [], genres: [] };
  }
}
