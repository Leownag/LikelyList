# Changelog

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
