import { ButtonLink } from "@/components/ui";
import { PixelMosaic, PixelRule, PixelDot } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";

const STEPS = [
  {
    label: "01 / follow",
    title: "Pick your cities and genres",
    body: "Choose the cities you'd actually travel to and the genres you actually listen to. Change them whenever — nothing is locked in.",
  },
  {
    label: "02 / feed",
    title: "Paste flyers you like",
    body: "Screenshot a show poster, an Instagram story, a Spotify page. Paste it in. likelylist reads it and learns which artists and genres to weight more heavily.",
  },
  {
    label: "03 / friday",
    title: "One email, Friday morning",
    body: "Everything worth knowing about the coming week: who's playing, where, when, with thumbnails and links out to YouTube and Spotify.",
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
    Poster reading is not perfect. Anything extracted from an image is shown to
    you for confirmation before it changes your preferences.
  </>,
  <>
    United States listings only for now. Coverage outside the US runs on a
    different, much thinner Ticketmaster API.
  </>,
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Wordmark href={null} />
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">
            Sign in
          </ButtonLink>
          <ButtonLink href="/login?mode=signup">Get the digest</ButtonLink>
        </nav>
      </header>

      <section className="mt-20 flex items-start justify-between gap-8">
        <div className="max-w-xl">
          <p className="label-pixel">weekly show digest</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            The shows you&apos;d have found out about too late.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted">
            Every Friday morning, one email with the concerts happening near you
            in the coming week — filtered by the cities and genres you follow,
            and by the flyers you&apos;ve fed it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href="/login?mode=signup">Start following</ButtonLink>
            <span className="text-xs text-faint">
              Free. One email a week. One-click unsubscribe.
            </span>
          </div>
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

      <section className="mt-12 grid gap-8 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.label}>
            <p className="label-pixel">{step.label}</p>
            <h2 className="mt-3 text-base font-semibold tracking-tight">
              {step.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {step.body}
            </p>
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
        <Wordmark href={null} size="sm" />
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
