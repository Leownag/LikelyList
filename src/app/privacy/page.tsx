import type { ReactNode } from "react";
import Link from "next/link";
import { PixelRule } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";

export const metadata = {
  title: "Privacy — likelylist",
  description:
    "What likelylist collects, who processes it, how long it is kept, and how to get rid of it.",
};

/**
 * Privacy policy.
 *
 * Not optional decoration: Ticketmaster's developer terms require an app using
 * the Discovery API to publish a privacy policy describing its data handling, so
 * this is a launch blocker. Written to describe what the code actually does — if a
 * behaviour changes, this page has to change with it.
 *
 * The one claim worth re-checking against the code before every release is the
 * screenshot retention rule: api/feeds/route.ts only writes an image to storage
 * when extraction *failed*.
 */

const UPDATED = "4 August 2026";

export default function PrivacyPage() {
  // Read directly rather than through readEnv(), which hard-requires the Supabase
  // variables — this page is static and should not depend on them.
  const contact =
    (process.env.EMAIL_UNSUBSCRIBE_MAILTO ?? "").trim() ||
    "the address in your digest footer";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <header>
        <Wordmark />
        <p className="label-pixel mt-6">privacy</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          What we hold, and what we don&apos;t
        </h1>
        <p className="mt-3 text-sm text-muted">Last updated {UPDATED}.</p>
      </header>

      <PixelRule className="mt-8" />

      <div className="mt-10 space-y-10">
        <Section title="The short version">
          <p>
            likelylist stores your email address, the cities and genres you
            follow, and the artist names it learned from screenshots you chose to
            upload. It sends you one email a week. It does not sell anything, does
            not run advertising, does not track whether you open the email, and
            does not keep the screenshots.
          </p>
        </Section>

        <Section title="What we collect">
          <Definition term="Your email address">
            The only thing you have to give us. It is used to deliver the weekly
            digest and to sign you in &mdash; there is no password, so an emailed
            link is the whole login. Nothing else.
          </Definition>
          <Definition term="Your cities and genres">
            The selections you make yourself. These decide what the weekly email
            contains.
          </Definition>
          <Definition term="Artists and genres read from your screenshots">
            When you add a screenshot — typically a music app screen such as your
            Spotify home page, liked songs, a playlist or your top artists — a
            vision model reads the artist and song names visible on it, along with
            any genre words shown. Nothing from that reading changes your
            preferences until you confirm it.
          </Definition>
          <Definition term="A daily upload counter">
            A per-day count of how many screenshots you have processed, so one
            account cannot run up the processing bill. It holds a number, not the
            contents.
          </Definition>
          <Definition term="Your timezone and preferred send hour">
            Used to decide when to send your email so it arrives in your morning.
          </Definition>
        </Section>

        <Section title="Screenshots you upload">
          <p>This is the part most worth being precise about.</p>
          <p>
            An uploaded or pasted image is resized in your browser, sent to our
            server, passed once to the extraction model, and then{" "}
            <strong className="text-text">dropped</strong>. On a successful read it
            is never written to storage at all — it exists only in memory for the
            length of that one request. What is kept is the structured result: the
            artist and song names that were read, plus the raw text, so you can see
            what the model saw and correct it.
          </p>
          <p>
            A screenshot of a music app can show more than music — a username, a
            profile photo, notifications. Only the text is read, only artist names,
            song titles and genre words are stored, and the picture itself does not
            survive the request. If you would rather not send a particular screen at
            all, crop it first or skip it; the cities-and-genres route works
            perfectly well on its own.
          </p>
          <p>
            The single exception: if extraction <em>fails</em>, the image is stored
            privately so a retry does not require you to find the screenshot again.
            You can delete that at any time by discarding the feed, and deleting
            your account removes it too.
          </p>
          <p>
            Text inside an image is treated strictly as content to transcribe. It is
            never followed as an instruction, so a screenshot cannot direct the
            system to do anything.
          </p>
        </Section>

        <Section title="Who else processes your data">
          <p>
            likelylist is a small service built on other people&apos;s
            infrastructure. Each of these sees a specific slice:
          </p>
          <Definition term="Supabase">
            Hosts the database and handles sign-in. Holds your email address,
            preferences and feed results.
          </Definition>
          <Definition term="Cloudflare">
            Serves the site and runs the scheduled job. Sees request metadata such
            as your IP address, as any web host does.
          </Definition>
          <Definition term="Resend">
            Delivers the weekly email. Receives your email address and the message
            contents.
          </Definition>
          <Definition term="OpenAI">
            Receives the screenshots you choose to upload, one at a time, to read
            the text on them. It receives no account identifier alongside the
            image.
          </Definition>
          <Definition term="Ticketmaster">
            Provides the event listings. It receives our queries by city and date —
            these are made once per city and shared across everyone following it,
            so a query is not attributable to you.
          </Definition>
          <Definition term="YouTube">
            Provides video links. Because thumbnails and images in the email are
            loaded from their original hosts, opening the email lets those hosts see
            a request from your mail client. No third party is used to sign you in.
          </Definition>
        </Section>

        <Section title="What we don't do">
          <ul className="list-none space-y-2">
            <Bullet>
              No advertising, no ad networks, no data brokers, no selling or
              sharing your data for anyone else&apos;s marketing.
            </Bullet>
            <Bullet>
              No open or click tracking. There is no tracking pixel in the digest.
              Gmail fetches every image the moment a message is delivered, before a
              human sees it, so open rates would be noise even if we wanted them.
            </Bullet>
            <Bullet>
              No analytics scripts and no third-party cookies. The only cookie is
              the one that keeps you signed in.
            </Bullet>
            <Bullet>
              No sending to an address you did not give us. You only ever receive
              mail at the address on your own account.
            </Bullet>
          </ul>
        </Section>

        <Section title="How long things are kept">
          <Definition term="Your account and preferences">
            Until you delete them.
          </Definition>
          <Definition term="Event listings">
            Cached only for the current send and then purged, usually within a day
            and a half. Ticketmaster&apos;s terms permit caching event content only
            for as long as providing the service requires, and require removal
            within 24 hours on request — so this is a scratch buffer, not an
            archive.
          </Definition>
          <Definition term="Screenshots">
            Not kept on success. Kept only for a failed extraction, until you
            discard the feed or delete your account.
          </Definition>
          <Definition term="Links in the email">
            The &ldquo;view in browser&rdquo; link stops working after seven days,
            so a forwarded or leaked message does not stay a readable window into
            your account. The unsubscribe link never expires, because you must
            always be able to get out.
          </Definition>
        </Section>

        <Section title="Your choices">
          <Definition term="Stop the email">
            Use the unsubscribe link in any digest — one click, no confirmation
            step, no sign-in needed — or switch it off in{" "}
            <Link href="/app/settings" className="text-accent underline">
              Settings
            </Link>
            . Your account and everything you follow stay intact.
          </Definition>
          <Definition term="Change or remove what was learned">
            Cities, genres and learned artists are all editable in{" "}
            <Link href="/app/subscriptions" className="text-accent underline">
              Cities &amp; genres
            </Link>
            . Removing a genre records it as a standing preference, so a later
            screenshot will not quietly add it back.
          </Definition>
          <Definition term="Delete everything">
            <Link href="/app/settings" className="text-accent underline">
              Settings
            </Link>{" "}
            has an account deletion that removes your profile, subscriptions,
            genres, learned artists, every feed, and any retained image. It is
            immediate and cannot be undone.
          </Definition>
        </Section>

        <Section title="Contact">
          <p>
            Questions, corrections, or a request to remove something: {contact}.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If what the service does with your data changes, this page changes
            with it and the date at the top moves. Material changes will be
            mentioned in a digest rather than made quietly.
          </p>
        </Section>
      </div>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-xs text-faint">
        <Wordmark href="/" size="sm" />
        <p className="flex flex-wrap gap-4">
          <Link href="/" className="underline hover:text-muted">
            Home
          </Link>
          <a
            className="underline hover:text-muted"
            href="https://www.youtube.com/t/terms"
            rel="noreferrer noopener"
            target="_blank"
          >
            YouTube Terms
          </a>
        </p>
      </footer>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </section>
  );
}

function Definition({ term, children }: { term: string; children: ReactNode }) {
  return (
    <p>
      <span className="text-text">{term}.</span> {children}
    </p>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0"
        style={{ background: "var(--pixel-2)" }}
      />
      <span>{children}</span>
    </li>
  );
}
