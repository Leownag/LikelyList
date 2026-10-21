import { PixelMosaic, PixelRule } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import { PublicHeader } from "@/components/public-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { readEnv } from "@/lib/env";
import type { City, Genre } from "@/lib/db";
import { ExploreClient } from "./explore-client";
import type { SubscribeCity, SubscribeGenre } from "@/components/anonymous-subscribe";
import type { Metadata } from "next";

/** Same reason as the landing page: the city and genre lists come from the
 *  database, so prerendering would freeze them at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore this week",
  description:
    "See which concerts are on this week near any US city or ZIP code, filtered by genre. " +
    "No account, no email needed.",
  // The results live in client state, so every search renders at this one URL. Saying so
  // explicitly keeps any future `?city=` variant from splitting the page's signals.
  alternates: { canonical: "/explore" },
};

export default async function ExplorePage() {
  const { cities, genres } = await loadPickers();

  // Pinning needs a session, so the page asks once and the client renders the button
  // only when there is one — a row of buttons that bounce to /login is a worse answer
  // than no buttons for somebody who came here precisely to avoid an account.
  const user = await getUser();
  const pinnedIds = user ? await loadPinnedIds() : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      {/* The subscribe box lives at the bottom of the results, attached to a search
          someone has actually looked at, which is a better moment to ask for an address
          than the top of an empty page. */}
      <PublicHeader current="explore" signedIn={Boolean(user)} />

      <section className="mt-14 flex items-start justify-between gap-8">
        <div className="max-w-xl">
          <p className="label-pixel">no password, no signup form</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
            What&apos;s on this week
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Pick a city or type a ZIP code, narrow it by genre, and see the next
            seven days. Nothing is emailed, nothing is saved — this is just the
            same data the Wednesday digest is built from.
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
          <ExploreClient
            cities={cities}
            genres={genres}
            signedIn={Boolean(user)}
            pinnedIds={pinnedIds}
          />
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

/**
 * Which events this reader has already pinned.
 *
 * Through the request-scoped client, so RLS scopes it to them without this code
 * passing a user id — and it returns ids only, because that is all the button needs
 * to start in the right state.
 */
async function loadPinnedIds(): Promise<string[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("pinned_events").select("tm_event_id");
    return ((data ?? []) as { tm_event_id: string }[]).map((row) => row.tm_event_id);
  } catch {
    // A pin state that fails to load should cost an un-highlighted button, not the page.
    return [];
  }
}
