import { ButtonLink } from "@/components/ui";
import { PixelMosaic, PixelRule, PixelDot } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import { StepCities, StepFeed, StepEmail } from "@/components/step-art";
import {
  AnonymousSubscribe,
  type SubscribeCity,
  type SubscribeGenre,
} from "@/components/anonymous-subscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEnv } from "@/lib/env";
import type { City, Genre } from "@/lib/db";

/**
 * Rendered per request, not prerendered.
 *
 * This page reads the city and genre lists from the database. Left static, Next
 * prerenders it at build time and bakes whatever those queries returned *then* —
 * which on a build without database credentials is an empty list, so the subscribe
 * box silently disappears in production. Two small queries per request is the
 * right trade for the page always reflecting the seeded data.
 */
export const dynamic = "force-dynamic";

const STEPS = [
  {
    label: "01 / your email",
    title: "One address, one confirmation",
    body: "No password, no account to set up. Pick your city and a genre or two, confirm from your inbox, and you're subscribed. Coming back later means asking for a link — that's the whole login.",
    art: <StepCities />,
  },
  {
    label: "02 / your artists",
    title: "Name the ones you keep missing",
    body: "Search for anyone you don't want to miss again, or screenshot your Spotify or Apple Music home screen and let it read the names off. Their shows reach you even in a genre you don't follow.",
    art: <StepFeed />,
  },
  {
    label: "03 / friday",
    title: "One email, Friday morning",
    body: "What goes on sale this week — the part you can still act on — then who's playing, where and when, with links out to YouTube and Spotify.",
    art: <StepEmail />,
  },
];

const CAVEATS = [
  <>
    Listings come from Ticketmaster, which does not publish billing order.
    likelylist marks the act it can identify as the headliner and labels everyone
    else <span className="text-text">same bill</span> — it will not invent an
    opening act it cannot verify.
  </>,
  <>
    Reading a screenshot is not perfect. Everything it thinks it found is shown to
    you for confirmation before it changes anything, and the image itself is read
    once and not kept.
  </>,
  <>
    On-sale dates are only as good as what Ticketmaster has published. Plenty of
    events have none yet, and presales are not distinguished from the general
    onsale — so this tells you what has been{" "}
    <span className="text-text">announced</span>, not everything that will
    happen.
  </>,
  <>
    United States listings only for now. Coverage outside the US runs on a
    different, much thinner Ticketmaster API.
  </>,
];

/**
 * Loads the city and genre lists for the anonymous subscribe box.
 *
 * Failures are swallowed on purpose: this is the front page, and a Supabase
 * hiccup or a fresh clone with no credentials should degrade to the sign-up
 * button rather than showing an error where the marketing copy goes.
 */
async function loadPickers(): Promise<{
  cities: SubscribeCity[];
  genres: SubscribeGenre[];
}> {
  try {
    const env = readEnv();
    if (!env.supabaseServiceRoleKey) return { cities: [], genres: [] };

    const supabase = createAdminClient(env);
    const [citiesResult, genresResult] = await Promise.all([
      supabase.from("cities").select("slug, name, state_code").order("sort_order"),
      supabase.from("genres").select("id, name").order("sort_order"),
    ]);

    return {
      cities: (
        (citiesResult.data ?? []) as Pick<City, "slug" | "name" | "state_code">[]
      ).map((city) => ({
        slug: city.slug,
        name: city.name,
        stateCode: city.state_code,
      })),
      genres: ((genresResult.data ?? []) as Pick<Genre, "id" | "name">[]).map(
        (genre) => ({ id: genre.id, name: genre.name }),
      ),
    };
  } catch {
    return { cities: [], genres: [] };
  }
}

export default async function Home() {
  const { cities, genres } = await loadPickers();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Wordmark href={null} />
        {/* No primary button up here on purpose. The subscribe box below is the
            page's one primary action, and a header CTA pointing at /login was
            competing with it — offering a longer path to the same thing. */}
        <nav className="flex items-center gap-2">
          <ButtonLink href="/explore" variant="ghost">
            Explore
          </ButtonLink>
          <ButtonLink href="/login" variant="ghost">
            Sign in
          </ButtonLink>
        </nav>
      </header>

      <section className="mt-20 flex items-start justify-between gap-8">
        <div className="max-w-xl">
          <p className="label-pixel">weekly show digest</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            The shows you&apos;d have found out about too late.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted">
            Every Friday morning, one email: what goes on sale this week, and who&apos;s
            playing near you in the next seven days — filtered by the cities and
            genres you follow, the artists you name, and what your music app says
            you actually listen to.
          </p>

          {/* Both lists are required: the box asks for a city and at least one
              genre, so rendering it against an unseeded database would produce a
              form that cannot be submitted. */}
          {cities.length > 0 && genres.length > 0 ? (
            <>
              <div className="mt-8">
                <AnonymousSubscribe cities={cities} genres={genres} />
              </div>
              {/* Promoted from 12px grey body text to a real secondary button.
                  Someone who has just missed a show wants to see whether this
                  thing knows about their city before handing over an address, and
                  that was the least visible element on the page. */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ButtonLink href="/explore" variant="outline">
                  Or browse this week first
                </ButtonLink>
                <span className="text-xs text-faint">
                  No email needed. Nothing saved.
                </span>
              </div>
            </>
          ) : (
            // Degraded path: subscribing cannot work without the reference data,
            // so send people to the one thing that still does.
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/explore">See what&apos;s on this week</ButtonLink>
              <span className="text-xs text-faint">
                The weekly email is not taking signups yet.
              </span>
            </div>
          )}
        </div>

        <PixelMosaic
          seed="likelylist-hero"
          cols={9}
          rows={12}
          cell={10}
          density={0.3}
          className="hidden sm:grid"
        />
      </section>

      <PixelRule className="mt-20" />

      <section className="mt-12 grid gap-10 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.label}>
            {step.art}
            <p className="label-pixel">{step.label}</p>
            <h2 className="mt-2 text-base font-semibold tracking-tight">
              {step.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
          </div>
        ))}
      </section>

      <PixelRule className="mt-16" />

      <section className="mt-12">
        <p className="label-pixel">what it is honest about</p>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
          {CAVEATS.map((caveat, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1.5">
                <PixelDot color="var(--pixel-3)" size={6} />
              </span>
              <span>{caveat}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-20 text-xs text-faint">
        <span className="flex flex-wrap items-center gap-4">
          <Wordmark href={null} size="sm" />
          <a className="underline hover:text-muted" href="/privacy">
            Privacy
          </a>
        </span>
        <p>
          Event data via Ticketmaster. Video data via YouTube (
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
