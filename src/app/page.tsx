import { ButtonLink } from "@/components/ui";
import { PixelMosaic, PixelRule, PixelDot } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import { LanguageSwitch } from "@/components/language-switch";
import { StepCities, StepFeed, StepEmail } from "@/components/step-art";
import {
  AnonymousSubscribe,
  type SubscribeCity,
  type SubscribeGenre,
} from "@/components/anonymous-subscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { readEnv } from "@/lib/env";
import type { City, Genre } from "@/lib/db";
import type { Metadata } from "next";
import { siteUrlFromEnv, localePath, localeAlternates } from "@/lib/site-url";
import { getLocale } from "@/lib/i18n/server";
import { isLocale, LOCALE_HTML_LANG, type Locale } from "@/lib/i18n/locales";
import { translator } from "@/lib/i18n/messages";

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
const STEP_KEYS = ["email", "artists", "friday"] as const;

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
  return isLocale(explicit) ? explicit : await getLocale();
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

export default async function Home({ searchParams }: PageProps<"/">) {
  // Already signed in is a normal way to arrive here — the wordmark in the app header
  // links to /, and so does every logo in the digest email. Showing "Sign in" to
  // someone who is signed in reads as "your session is gone", and sends them the long
  // way round to a page they can already see.
  //
  // Cheap: this page is force-dynamic anyway, and getUser() is one cookie read plus a
  // token check.
  const [{ cities, genres }, user, locale] = await Promise.all([
    loadPickers(),
    getUser(),
    resolveLocale(searchParams),
  ]);
  const t = translator(locale);

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
      <header className="flex items-center justify-between">
        <Wordmark href={null} />
        {/* No primary button up here on purpose. The subscribe box below is the
            page's one primary action, and a header CTA pointing at /login was
            competing with it — offering a longer path to the same thing. */}
        <nav className="flex items-center gap-2">
          <LanguageSwitch className="mr-1" />
          <ButtonLink href="/explore" variant="ghost">
            {t("common.explore")}
          </ButtonLink>
          {user ? (
            <ButtonLink href="/app" variant="ghost">
              {t("nav.feed")}
            </ButtonLink>
          ) : (
            <ButtonLink href="/login" variant="ghost">
              {t("common.signIn")}
            </ButtonLink>
          )}
        </nav>
      </header>

      <section className="mt-20 flex items-start justify-between gap-8">
        <div className="max-w-xl">
          <p className="label-pixel">{t("brand.tagline")}</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {t("landing.h1")}
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted">
            {t("landing.sub")}
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
