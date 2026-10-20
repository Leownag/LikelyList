import { ButtonLink, Notice } from "@/components/ui";
import { PixelMosaic, PixelRule, PixelDot } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import { PublicHeader } from "@/components/public-header";
import { StepCities, StepFeed, StepEmail } from "@/components/step-art";
import { ServiceIconImg } from "@/components/service-icon-img";
import { SpotifyConnectButton } from "@/components/spotify-connect";
import {
  AnonymousSubscribe,
  type SubscribeCity,
  type SubscribeGenre,
} from "@/components/anonymous-subscribe";
import { DigestOnTheWay } from "@/components/digest-on-the-way";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { readEnv } from "@/lib/env";
import { nextDigestLabel } from "@/lib/time";
import type { City, Genre, Profile } from "@/lib/db";
import type { Metadata } from "next";
import { siteUrlFromEnv, localePath, localeAlternates } from "@/lib/site-url";
import { getLocale } from "@/lib/i18n/server";
import { isEnabledLocale, LOCALE_HTML_LANG, type Locale } from "@/lib/i18n/locales";
import { translator } from "@/lib/i18n/messages";
import { cookies } from "next/headers";
import { DEV_MODE_COOKIE, isDevMode } from "@/lib/dev-mode";

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

/** The step art, in the order the copy keys are listed below. */
const STEP_ART = [<StepCities key="a" />, <StepFeed key="b" />, <StepEmail key="c" />];
const STEP_KEYS = ["email", "artists", "midweek"] as const;

const CAVEAT_KEYS = [
  "landing.honest.lineup",
  "landing.honest.screenshot",
  "landing.honest.onsale",
  "landing.honest.us",
] as const;

/**
 * The locale for this page, with `?lang=` outranking the cookie.
 *
 * The root layout resolves the locale from the cookie and `Accept-Language` and cannot see
 * search params at all, so `<html lang>` can disagree with the copy here when someone
 * follows a `?lang=` link. Left as is on purpose: Google states it ignores the `lang`
 * attribute and reads the visible text and `hreflang` instead, and the alternative is
 * middleware this project deliberately does not have.
 */
async function resolveLocale(
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>,
): Promise<Locale> {
  const lang = (await searchParams).lang;
  const explicit = Array.isArray(lang) ? lang[0] : lang;
  return isEnabledLocale(explicit) ? explicit : await getLocale();
}

/**
 * Per-locale title, description and canonical.
 *
 * The canonical is self-referencing per locale — `/` for English, `/?lang=zh-Hant` for
 * Chinese. Pointing the Chinese page at `/` instead would tell Google the translation is a
 * duplicate to be dropped, which is the one mistake that makes the whole thing pointless.
 *
 * No `openGraph` block: declaring one here would replace the layout's whole object and
 * drop og:site_name, og:type and og:locale. Omitted, og:title and og:description come from
 * the title and description below.
 */
export async function generateMetadata({
  searchParams,
}: PageProps<"/">): Promise<Metadata> {
  const locale = await resolveLocale(searchParams);
  const t = translator(locale);

  return {
    // The brand name is inside `landing.meta.title` rather than added by a template:
    // `title.template` in the layout applies to child segments, not to this one, so
    // without it the home page would be the only page whose title never says likelylist —
    // the one query it is certain to rank for.
    title: t("landing.meta.title"),
    description: t("landing.meta.description"),
    alternates: {
      canonical: localePath("/", locale),
      languages: localeAlternates("/"),
    },
    // Spelled out in full because a page-level openGraph replaces the layout's object
    // rather than merging with it — omitting `siteName` here would delete it, and
    // inheriting the layout's would label the Chinese page en_US.
    openGraph: {
      type: "website",
      siteName: "likelylist",
      locale: OG_LOCALE[locale],
      title: t("landing.meta.title"),
      description: t("landing.meta.description"),
      url: localePath("/", locale),
    },
  };
}

/** Open Graph wants a POSIX-style locale, not a BCP 47 tag. */
const OG_LOCALE: Record<Locale, string> = { en: "en_US", "zh-Hant": "zh_TW" };

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
  spotify: boolean;
}> {
  try {
    const env = readEnv();
    // Returned from in here rather than read in the page: readEnv() throws without the
    // Supabase variables, and this try is the only place already prepared for that.
    const spotify = Boolean(env.spotifyClientId);
    if (!env.supabaseServiceRoleKey) return { cities: [], genres: [], spotify };

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
      spotify,
    };
  } catch {
    return { cities: [], genres: [], spotify: false };
  }
}

/**
 * The signed-in reader's delivery schedule, or null.
 *
 * Read through the session client rather than the admin one — RLS already scopes
 * `profiles` to the row asking, so there is no id to pass and no way to ask for
 * somebody else's. Null on any failure: this block is a nicety, and the page still
 * has a subscribe box to fall back to.
 */
type Schedule = Pick<Profile, "timezone" | "digest_send_hour" | "digest_enabled">;

async function loadSchedule(): Promise<Schedule | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("timezone, digest_send_hour, digest_enabled")
      .maybeSingle<Schedule>();
    return data;
  } catch {
    return null;
  }
}

export default async function Home({ searchParams }: PageProps<"/">) {
  // Already signed in is a normal way to arrive here — the wordmark in the app header
  // links to /, and so does every logo in the digest email. Showing "Sign in" to
  // someone who is signed in reads as "your session is gone", and sends them the long
  // way round to a page they can already see.
  //
  // Cheap: this page is force-dynamic anyway, and getUser() is one cookie read plus a
  // token check.
  const [{ cities, genres, spotify }, user, locale] = await Promise.all([
    loadPickers(),
    getUser(),
    resolveLocale(searchParams),
  ]);
  const t = translator(locale);

  // Set by deleteAccount, which otherwise drops the reader here with no sign
  // that anything happened.
  const justDeleted = (await searchParams).deleted === "1";

  // Operator-facing byte sizes in the build panel, off unless dev mode is on
  // for this browser.
  const diagnostics = await isDevMode({
    cookieValue: (await cookies()).get(DEV_MODE_COOKIE)?.value,
    secret: readEnv().cronSecret,
  });

  // Second round-trip, and only for the minority who are signed in: the schedule is the
  // whole point of what they get shown instead of the subscribe box, and it cannot be
  // asked for until getUser() has said who they are.
  const profile = user ? await loadSchedule() : null;

  return (
    // `lang` here rather than on <html>: the root layout resolves the locale from the
    // cookie and Accept-Language and cannot read `?lang=`, so on a `?lang=` visit the
    // document element disagrees with this copy. `lang` is valid on any element and scopes
    // its subtree, which is what a screen reader and a language detector both read.
    <main
      lang={LOCALE_HTML_LANG[locale]}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10"
    >
      {/* WebSite only. Organization earns nothing without brand search volume, and
          MusicEvent needs per-event pages the Ticketmaster terms do not allow us to keep. */}
      <script
        type="application/ld+json"
        // JSON.stringify escapes the copy; the keys are literals from this file.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "likelylist",
            url: `${siteUrlFromEnv()}${localePath("/", locale)}`,
            description: t("landing.meta.description"),
            inLanguage: LOCALE_HTML_LANG[locale],
          }),
        }}
      />
      <PublicHeader current="home" signedIn={Boolean(user)} t={t} />

      {justDeleted ? (
        <div className="mt-8">
          <Notice tone="success">{t("landing.deleted")}</Notice>
        </div>
      ) : null}

      <section className="mt-20 flex items-start justify-between gap-8">
        <div className="max-w-xl">
          <p className="label-pixel">{t("brand.tagline")}</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {t("landing.h1")}
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted">
            {t("landing.sub")}
          </p>

          {/* Somebody already subscribed does not need the subscribe box; what they
              came here for is when the next one arrives. Needs the profile too — with
              no schedule to show, the box below is still a truthful thing to render. */}
          {profile ? (
            <div className="mt-8">
              <DigestOnTheWay
                nextSendLabel={nextDigestLabel(profile, locale)}
                paused={!profile.digest_enabled}
                diagnostics={diagnostics}
              />
            </div>
          ) : /* Both lists are required: the box asks for a city and at least one
              genre, so rendering it against an unseeded database would produce a
              form that cannot be submitted. */
          cities.length > 0 && genres.length > 0 ? (
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
                  {t("landing.browse")}
                </ButtonLink>
                <span className="text-xs text-faint">
                  {t("landing.browse.hint")}
                </span>
              </div>
            </>
          ) : (
            // Degraded path: subscribing cannot work without the reference data,
            // so send people to the one thing that still does.
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/explore">{t("landing.unseeded.action")}</ButtonLink>
              <span className="text-xs text-faint">
                {t("landing.unseeded.hint")}
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
        {STEP_KEYS.map((step, i) => (
          <div key={step}>
            {STEP_ART[i]}
            <p className="label-pixel">{t(`landing.step.${step}.label`)}</p>
            <h2 className="mt-2 text-base font-semibold tracking-tight">
              {t(`landing.step.${step}.title`)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {t(`landing.step.${step}.body`)}
            </p>
          </div>
        ))}
      </section>

      {/* After the steps, not before: step 02 has just promised that a screenshot can
          fill in your artists, and this is the same promise without the screenshot. It
          needs that context to read as an upgrade rather than a second funnel. */}
      {spotify ? (
        <>
          <PixelRule className="mt-16" />

          <section className="mt-12">
            <ServiceIconImg service="spotify" size={21} />
            <p className="label-pixel mt-3">{t("landing.spotify.label")}</p>
            <h2 className="mt-2 text-base font-semibold tracking-tight">
              {t("landing.spotify.title")}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              {t("landing.spotify.body")}
            </p>

            {/* Anonymous readers are the point of this button being here, and
                /api/spotify/connect already handles them: it bounces to /login with a
                `next` back to itself, so the emailed link resumes the connect. */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <SpotifyConnectButton />
              {user ? null : (
                <span className="text-xs text-faint">
                  {t("landing.spotify.signIn")}
                </span>
              )}
            </div>
          </section>
        </>
      ) : null}

      <PixelRule className="mt-16" />

      <section className="mt-12">
        <p className="label-pixel">{t("landing.honest.heading")}</p>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
          {CAVEAT_KEYS.map((key) => (
            <li key={key} className="flex gap-3">
              <span className="mt-1.5">
                <PixelDot color="var(--pixel-3)" size={6} />
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-20 text-xs text-faint">
        <span className="flex flex-wrap items-center gap-4">
          <Wordmark href={null} size="sm" />
          <a className="underline hover:text-muted" href="/privacy">
            {t("common.privacy")}
          </a>
        </span>
        <p>
          {t("landing.attribution")} (
          <a
            className="underline hover:text-muted"
            href="https://www.youtube.com/t/terms"
            rel="noreferrer noopener"
            target="_blank"
          >
            {t("common.terms")}
          </a>
          ).
        </p>
      </footer>
    </main>
  );
}
