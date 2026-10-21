# Changelog

## 1.1.6 — 2026-10-21

Timezone correctness, gone over deliberately because it decides when an email
arrives and what a calendar entry says.

- **A calendar entry for an event with no timezone was four hours wrong.** The
  zone fell back to UTC, so an 8pm Boston show was written as 20:00Z and read
  4pm — the failure the file documents itself as existing to prevent. It now
  goes all-day on the venue's date: right day, no invented hour. A test had
  recorded the broken output as correct.
- **DST is now actually tested.** Six Wednesdays across a year, either side of
  both US transitions, against every zone and send hour — 252 combinations. Plus
  a show in the hour after the clocks jump forward, which is the only case that
  exercises the two-pass offset correction, verified by breaking it.
- Explore states its window as the range of rows returned. Bounding the search
  by UTC instants while labelling rows with venue-local dates cannot produce a
  header that agrees, and two earlier attempts failed in opposite directions.

Verified sound, not changed: showtimes are never re-zoned (a venue's 8pm is 8pm
for every reader) while onsales always are (one instant everybody races), and
every event from the live API carries a zone, so only pins predating that can
reach the all-day path.

## 1.1.5 — 2026-10-20

- **A place read as "BostonMA".** Three surfaces spaced a name and its state
  code with CSS rather than a character, so anything reading the text — a
  copy-paste, a screen reader — got them glued, differently on each surface.
- **The build cooldown was per browser, not per account.** The server counts it
  per user; the client kept one localStorage deadline for all of them.
- **"NO ACCOUNT NEEDED" sat next to a Sign in link.** There is an account; what
  is true is that there is no password and no form.
- The genre legend pointed at "a screenshot you added" when provenance is only
  recorded as "a feed" — which made an unreadable screenshot look like it had
  still inferred something.

## 1.1.4 — 2026-10-20

- **Everyone who signed in was in Eastern.** `profiles.timezone` defaults to
  America/New_York and the row is created by a trigger on `auth.users`, which
  cannot know where the reader is. Only the subscribe box sent a detected zone.
  A reader in Seattle got their "Wednesday 8am" email at 5am. A profile that is
  minutes old and still on the default now adopts the browser's zone; an older
  one is offered the swap in Settings rather than having it taken.
- **Explore no longer server-renders a guessed city.** It rendered the default
  slug and swapped to the real guess after hydration, so the HTML, the
  accessibility tree and the screen disagreed on first load — and a search
  clicked in that window returned the wrong city's week.
- The landing form showed eight genres of twenty-two under copy claiming that
  was what the email filters on.
- A search result you already follow says Following.
- Spotify's three numbers — fifty asked for, forty-four returned, twenty-four
  displayed — now say which is which.
- "Or build it now" had no preceding alternative; "labels everyone else same
  bill" was missing a word; "favourite" in a US product.

## 1.1.3 — 2026-10-20

Testing, shaped by what got through. Each layer covers something the others
structurally cannot.

- **`/api/health` reports the commit it was built from**, and `npm run deploy`
  now checks it. Cloudflare reports success as soon as it accepts an upload,
  which says nothing about what was uploaded — a release deployed cleanly from
  an unmerged branch and the previous build stayed live for an hour.
- **`npm run smoke [url]`** — seventeen read-only checks against the live site,
  no login, a few seconds.
- **`npm run test:ui:prod`** runs the Playwright walk against production.
  `isDevMode` returns true unconditionally outside production, so anything
  gated on it is unreachable from a dev server.
- **A copy-consistency test** reads the Supabase email templates directly.
  Nothing that drives a browser can see them; a sweep missed them, and the
  sign-in email offered to stop "the Friday email".
- **The walk seeds its own history.** It ran entirely against accounts created
  seconds earlier, so screens that need a past were never reached.

Fixed by the last of those: an applied screenshot that contributed a genre and
no names reported "Applied · 0 artists", while the genre grid on the same page
credited that feed.

## 1.1.2 — 2026-10-20

Two of these are regressions from 1.1.0, found by a pass over the deployed site.

- **"Build it now" was a dead end.** Gating the summary panel on dev mode hid
  the byte sizes it was meant to hide and, in the same block, the result, the
  error and the link to read the digest. In production that left a button that
  locked itself for three minutes and said nothing. The panel is split along the
  line that matters, and an empty week now explains itself.
- **Explore under-reported its own window.** Reading the header back off the
  returned rows fixed one disagreement and created another: results are
  date-ordered and capped at one page, so the header shrank below the seven days
  the copy promises. It now states the full window and says when the page ran
  out.
- The Friday sweep missed `supabase/email-templates`, so the sign-in email still
  offered to "stop the Friday email".
- "Back without saving" discarded *and* navigated; it discards in place now.
- The feed's empty state blamed a brand-new account regardless of the account.

## 1.1.1 — 2026-10-20

Migration `0017` installs pg_trgm into `extensions` rather than `public`.
Supabase exposes `public` over PostgREST, so anything landing there becomes a
callable RPC — the subject of migration `0004`. Caught before 0017 had been
applied anywhere, so there is nothing to undo.

## 1.1.0 — 2026-10-20

A UX pass. Every entry here traces to something a reader hit, not to a tidy-up.

### The weekly email moves to Wednesday morning

The day now lives in `DIGEST_WEEKDAY` rather than being implied by a cron
expression. That difference fixed a real bug: the send instant used to be read
off whatever calendar day the run landed on *in the reader's own zone*, and a
Friday 08:00 UTC run is already Thursday evening west of UTC-9 — so a reader in
Honolulu got a "Friday" email on a Thursday. Every supported zone is now
asserted to land on its local Wednesday.

The builder runs Wednesday 08:00 UTC. `scripts/cron.test.ts` ties that to
`worker.ts` and to the timezone list, because the failure mode is silent and
total: `worker.ts` routes a trigger by string equality, so changing the schedule
in one file alone makes every weekly trigger fall through to "drain" — the run
is never built, nobody is emailed, and nothing errors.

Settings offers morning hours only, and the timezone list is US-only — London,
Taipei and Tokyo were offered and could never match a listing.

### Finding a place

Suggestions are ordered by how close they are to you, inside bands of
significance. They were ordered by a rank whose tiebreak is **land area**, so
Camarillo, CA came before Cambridge, MA for "cam" no matter who was typing —
and with eight rows shown, Cambridge was not on the list at all. Measured
against the live table from Boston it was twelfth; it is now first.

- Arrow keys, with `aria-activedescendant`. Enter used to take the top match
  unconditionally, so reaching the third suggestion meant typing until it was
  the first.
- A word that is not the first now matches ("francisco", "boston ma"), via a
  trigram index. Requires migration `0017`; degrades safely without it.
- Blur keeps a half-typed name instead of discarding it.
- Searching, no match and unreachable are three different messages. A dropped
  connection used to say the town does not exist.
- `/explore` refuses a half-typed place instead of silently searching whatever
  the timezone guessed — typing "Amherst" and pressing the button returned a
  week of New York shows.

### Saying what happened

`StatusLine` is new, because there was nothing of the kind: saving settings,
following a town, disconnecting Spotify and a failed pin were all silent.

- The Spotify callback has always redirected with one of nine outcome codes and
  the page read none of them. Cancelling at the consent screen returned you to
  an unchanged page.
- A failed pin rolled back without a word; a successful one never said where the
  show went.
- Discarding a screenshot was `void fetch(DELETE)` — not awaited, result ignored.
- Deleting your account dropped you on the marketing page with no sign it had
  happened.

### Elsewhere

- `/app` has a loading skeleton; the app has a 404 of its own. Clicking a nav
  link used to look like nothing had happened, and an unknown path served Next's
  unstyled page.
- The nav says which section you are in.
- One answer to "how is a place written". A seeded row carried its state twice,
  which two renderers turned into "Washington, DC, DC" and "WashingtonDCDC".
- `/explore` states the week it actually shows. The window was computed in UTC
  while every row is labelled with the venue's local date, so the header said
  the 20th above a row dated the 19th — and the buy link for a show that has
  been and gone reads TICKET SALES TERMINATED.
- Operator detail is behind the dev-mode cookie: byte sizes against Gmail's clip
  limit, "DELIVERED: not sent", an npm command, two environment variable names.
- The preview button and the one that sends a real email no longer look alike.
- "Spotify has revoked the connection" used `text-warn`, a token that does not
  exist, so it rendered off-palette. Form fields no longer suppress their focus
  ring for keyboard users.
- No more false precision: the next send is stated to the hour, with "around",
  because Cloudflare spreads a trigger across the hour it fires in.

### Repository

MIT licensed. A whole-system diagram in the README. `.specstory/` is ignored —
`.cursorindexingignore` governs Cursor's indexer and says nothing to git.

### Deploying this

1. Apply migration `0017_place_contains_search.sql`.
2. `npm run seed:cities` — a corrected name for Washington, DC.
3. `npm run deploy`. The cron changes on deploy.

## 1.0.0

Initial release.
