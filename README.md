# likelylist

**[likelylist.tech](https://likelylist.tech)** — a weekly Wednesday email of upcoming
concerts, filtered by the cities and genres you follow and by the show flyers you
paste in.

- **Listings** come from the Ticketmaster Discovery API (US only).
- **Preferences** come from three places: cities and genres you pick explicitly,
  artists you search for by name, and artists/genres inferred from screenshots you
  feed it.
- **Feeds** are read by an OpenAI vision model under a strict JSON schema, and
  every extraction is shown to you for confirmation before it changes anything.
- **On-sale dates** get their own section, above the week's listings. A midweek
  email about the next seven days is already too late for anything in demand —
  those tickets went weeks ago — so the part you can still act on comes first.
- **Delivery** is one email per subscriber per week, released when that
  subscriber's own local clock reaches their chosen hour.

**There is no registration.** You give an address, confirm it, and that is the
account; signing back in means asking for a link. There is no password anywhere in
the product — see *Accounts* below for why that is a correctness requirement here
and not a preference.

Stack: Next.js 16 (App Router) on Cloudflare Workers via `@opennextjs/cloudflare`,
Supabase for Postgres + Auth + Storage, Resend + `react-email` for delivery.

---

## Architecture

### One Worker, four ways in

The whole project deploys as a single Cloudflare Worker. `@opennextjs/cloudflare`
compiles the Next.js app into `.open-next/worker.js`, which exports only `fetch`;
`worker.ts` wraps it and adds the handlers a Next build cannot produce:

| Trigger | Handler | Reaches |
| --- | --- | --- |
| HTTP request | `fetch` | any route in `src/app/` |
| Cron (`0 19 * * 2`, `*/5 * * * *`) | `scheduled` | `/api/cron/digest` |
| Inbound email (Email Routing) | `email` | `/api/inbound/unsubscribe` |

The two extra handlers deliberately import no application code. They construct a
`Request` and call the generated fetch handler in-process, so a cron pass and a
manual `curl` run exactly the same route, and the app is never bundled twice.

### Layers

```
src/app/      routes — React Server Components, route handlers, server actions
src/lib/      domain logic — no Next.js imports, unit-testable in isolation
src/components/  shared UI
```

The rule that keeps this workable: **routes hold no logic**. A route reads the
request, calls one `lib/` function, and shapes a response. Everything worth
testing therefore lives in `lib/` and is reachable from `node:test` without a
server — which is why the suite runs in about a second with no fixtures.

### Database access has two flavours, and the distinction is load-bearing

| Client | Key | Used by | RLS |
| --- | --- | --- | --- |
| `lib/supabase/server.ts` | anon key + user session | signed-in pages and actions | **enforced** |
| `lib/supabase/admin.ts` | service role key | the digest pipeline, public endpoints | bypassed |

Anything acting for a signed-in user goes through the request-scoped client, so
Postgres enforces ownership rather than application code remembering to. The
service-role client is confined to code paths with no user session at all. The
migrations assume this split: `0004` and `0005` revoke from `anon`/`authenticated`
exactly what only the pipeline should be able to do.

### The weekly pipeline

`lib/digest/` is four stages plus a drainer, and they are separate because they
fail differently:

```
digest/plan.ts    once a week: query Ticketmaster per distinct GRID CELL, cache
                  events, queue one job per subscriber with its own send_after
digest/drain.ts   every 5 min: claim due jobs atomically, recover expired leases
digest/build.ts   per subscriber: score cached events against their cities,
                  genres and artist preferences
email/render.tsx  react-email → HTML + plain text, measured against Gmail's
                  102 KB clip threshold
digest/send.ts    Resend, with both List-Unsubscribe forms
```

The drainer is also where retention lives, because it is the only thing that already
runs on a timer. Each pass calls `purge_stale_data()` and sweeps the screenshots kept
for failed extractions out of storage. Both are bounded, and both push failures into
`DrainResult.errors` rather than throwing — housekeeping must never be the reason an
email did not go out.

### Preferences come from two directions

Explicit picks (`app/app/subscriptions/`) write straight to `subscriptions` and
`genre_prefs`. Inferred picks come from screenshots: `api/feeds` sends the image
to `lib/vision/` under a strict schema, the user confirms the extraction, and
`lib/feeds/apply.ts` merges it — inserting a genre only where the user has no row
at all, so an explicit opt-out always survives a later screenshot.

### Public surface

`/`, `/explore`, `/privacy` and the subscribe flow need no account. Because they
spend Ticketmaster quota and send mail, each carries its own limit: a daily budget
plus a per-visitor hourly cap keyed on a truncated HMAC of the caller's IP, and
double opt-in before any address enters the send list.

Links arriving from an inbox — unsubscribe, subscribe-confirm, digest preview —
carry an HMAC token instead of a session (`lib/tokens.ts`), because a mail client's
request has no cookies. The first two render through `lib/standalone-page.ts`: no
React, no layout, no session, translated from `Accept-Language`. They are the
pages that must be the least breakable things in the app.

Those three pages are also the whole indexable surface, and `sitemap.ts` lists exactly
them. Titles come from one `title.template` in the root layout, so each page exports a
bare title. Note that a page-level `openGraph` **replaces** the layout's object rather
than merging into it — so the layout deliberately declares only `type`, `siteName` and
`locale` there, and lets `og:title` and `og:description` fall back to each page's own.

**`?lang=` is what makes a translation indexable.** In the app the locale comes from a
cookie and `Accept-Language` (`lib/i18n/server.ts`), which is right for a reader and
useless for a crawler: Google sends neither, so one URL serving two languages gets
indexed as English and the Chinese copy is invisible no matter how good it is. So the
landing page also accepts `?lang=`, which outranks the cookie, and `lib/site-url.ts`
(`localePath`, `localeAlternates`) is the single definition of where each locale lives.
`/` and `/?lang=zh-Hant` each declare a self-referencing canonical plus the full
reciprocal `hreflang` set — a canonical pointing at `/` instead would ask Google to drop
the translation as a duplicate.

Two consequences worth knowing. The root layout cannot read search params, so on a
`?lang=` visit `<html lang>` disagrees with the copy; the landing page therefore carries
`lang` on its own `<main>`, which is valid and is what a screen reader reads. And only the
landing page is translated — `/explore` and `/privacy` are English in every locale, which
is why they carry no `hreflang`. Adding one there before the copy exists would claim two
identical pages are alternates of each other.

### Cross-cutting

- `lib/errors.ts` + `lib/api-error.ts` — routes throw `AppError`; one function
  turns it into a response. Raw upstream detail is logged always, returned only in
  dev mode (`lib/dev-mode.ts`, a cookie rather than a global flag).
- `lib/safe-redirect.ts` — same-origin validation for any user-supplied redirect.
- `lib/time.ts` — timezone and DST arithmetic, used by every scheduling decision.
- `lib/env.ts` — one typed read of the environment, and the only place that
  validates required variables. The few modules that read `process.env` directly
  do so because they must work *without* credentials present:
  `lib/site-url.ts` (origin only, for `robots.ts` / `sitemap.ts` / `/privacy`),
  `lib/supabase/client.ts` and `server.ts` (public keys), and `lib/dev-mode.ts`.

---

## Setup

### 1. Cloudflare

**Workers Paid is required.** The free plan allows 10 ms of CPU and 50 subrequests
per invocation; one send batch has to call Ticketmaster, YouTube, Resend and
Supabase while rendering HTML, so it does not fit. The paid plan raises those to
30 s of CPU per request and 10,000 subrequests, which is ample — this workload
stays far below the included allotments.

### 2. Domain

A registered domain is required, and its **DNS must be served by Cloudflare's
nameservers** — a Workers custom domain does not work otherwise. The registration
itself can stay wherever the domain was bought; only DNS has to move.

**a. Add the zone to Cloudflare.** Dashboard → *Add a site* → your domain → Free
plan. Cloudflare scans the existing DNS and assigns two nameservers.

**b. Review the imported records before switching.** A freshly registered domain
usually has nothing worth keeping beyond the registrar's parking records. Delete
anything unrecognised now rather than debugging it later.

**c. Point the nameservers at Cloudflare** in the registrar's control panel,
replacing its default nameservers with the two Cloudflare assigned.

> If DNSSEC is enabled at the registrar, **turn it off first**. Changing
> nameservers while DNSSEC is still signed by the old provider makes the domain
> fail to resolve entirely.

**d. Wait for activation** — up to 24 hours, usually far less. The zone flips to
**Active**. Nothing below works until then.

**e. Then add the records the project needs**, in Cloudflare DNS:

| Purpose | Record |
| --- | --- |
| The app | Added for you by Workers → *Settings* → *Domains & Routes* → *Add custom domain* (`likelylist.tech`, and `www` if you want it) |
| Inbound unsubscribe | Cloudflare **Email Routing** → route `unsubscribe@likelylist.tech` to your real inbox (free). This is what `EMAIL_UNSUBSCRIBE_MAILTO` points at |
| Privacy contact | Email Routing → route `help@likelylist.tech` to your real inbox. Hardcoded in `src/app/privacy/page.tsx`, so it is a published commitment in a legally-required document — without this route, erasure requests bounce. Deliberately not the unsubscribe address: that one is machine-read and auto-processed |
| Resend SPF | `TXT` on `mail.likelylist.tech`, value from Resend |
| Resend DKIM | Record from Resend on `resend._domainkey.mail.likelylist.tech` |
| DMARC | `TXT` on `_dmarc.mail.likelylist.tech`, start at `v=DMARC1; p=none; rua=mailto:you@likelylist.tech` |

> Any CNAME Resend asks for must be set to **DNS only** (grey cloud, not orange).
> Proxying a mail-authentication record breaks verification, and this is the single
> most common way this setup fails.

Moving the registration to Cloudflare Registrar later is optional and changes
nothing above. Note that ICANN forbids transferring a domain within 60 days of
registration, and Cloudflare requires the zone to already be Active.

A note on newer gTLDs such as `.tech`: they carry marginally more spam history
than `.com`, so some filters weight them slightly worse. The mitigations are the
ones already built in — a dedicated sending subdomain, SPF + DKIM + DMARC, a real
`List-Unsubscribe`, and low volume to start.

No domain is hardcoded anywhere — `NEXT_PUBLIC_SITE_URL`, `EMAIL_FROM` and
`EMAIL_UNSUBSCRIBE_MAILTO` are read at runtime, so you can build and test the whole
thing on `localhost:3000` before any of this is done.

### 3. Services

Copy `.env.example` to `.env.local` (for `next dev`) and to `.dev.vars` (for
`wrangler dev`). Every variable's comment says where it comes from.

| Service | What you need | Notes |
| --- | --- | --- |
| [Supabase](https://supabase.com) | Project URL, anon key, service role key | Free tier is fine. Run the migrations below. |
| [Ticketmaster](https://developer.ticketmaster.com/) | Consumer key | Default quota: 5 req/sec, 5000 req/day. |
| [OpenAI](https://platform.openai.com/) | API key | Feed extraction only. Cents per hundred images. |
| [Spotify](https://developer.spotify.com/dashboard) | Client ID + secret | Optional. Enables the top-50 artist import. |
| [Google Cloud](https://console.cloud.google.com/) | A YouTube Data API v3 key | The API must be enabled manually. No OAuth client — nothing signs in with Google. |
| [Resend](https://resend.com) | API key + a verified sending domain | Needs the domain from step 2. |

**Spotify** is used for exactly one thing: reading a reader's top 50 artists into
their follow list. The scope requested is `user-top-read` and nothing else, so the
token cannot reach a playlist. No images and no genres are taken — Spotify's image
URLs expire, and a digest sits in an inbox for weeks, so all artwork comes from
Ticketmaster's CDN instead. The import re-runs every 30 days from the drainer.

Register both redirect URIs in the Spotify dashboard, because the callback URL is
derived from the request origin so that localhost works unchanged:

```
https://likelylist.tech/api/spotify/callback
http://localhost:3000/api/spotify/callback
```

Leaving `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` unset is supported: the
Connect button does not render and nothing else changes.

### Accounts — one way in, and why

Sign-in is **an emailed link**. Not a password, not Google, nothing else. One
screen, one field. The reasoning, in order:

- Confirming an anonymous subscription creates the auth user with
  `email_confirm: true` and **no password** (`lib/subscribe/anonymous.ts`), and
  most subscribers arrive that way. A password form could never have let those
  people in — they received the weekly email and could not change a single setting.
- The audience arrives at the moment they realise they missed a show. Asking for a
  password at that moment loses most of them, and it buys nothing: possession of
  the mailbox is already the credential, because the mailbox *is* the product.
- Google went the same way, later and for a narrower reason. It was carried to
  cover one case — a link opened in a different browser than the one that asked for
  it — and the `token_hash` flow below handles that directly and server-side. What
  remained was a second identity provider, an OAuth client to keep alive in Google
  Cloud, and a fork in the one screen that must never make anybody think.

So there is no OAuth branch in `/auth/callback` and no provider to enable. Google
Cloud is still needed, but only for the **YouTube** key.

Two settings make it work:

1. **Paste two email templates** at *Authentication → Email Templates*
   (`/dashboard/project/_/auth/templates`). Both live in
   `supabase/email-templates/` so they are reviewable in the repo rather than only
   inside a dashboard textarea; each file opens with the subject line to use and
   the reasoning behind its URL.

   | Dashboard template | File | `type=` |
   | --- | --- | --- |
   | **Magic link or OTP** — its real name; there is no entry called "Magic Link" | `magic-link.html` | `email` |
   | **Confirm sign up** | `confirm-signup.html` | `signup` |

   Both replace `{{ .ConfirmationURL }}` with a link built from
   `{{ .RedirectTo }}` plus `{{ .TokenHash }}`. `/auth/callback` verifies the hash
   server-side with `verifyOtp` and accepts `magiclink`, `email`, `signup`,
   `invite`, `recovery` and `email_change`.

   Three things about these that are easy to get wrong:

   - **The signup template is not optional.** The login form calls
     `signInWithOtp` with `shouldCreateUser: true`, so an address Supabase has
     never seen receives the *signup* template, not the magic-link one. Leave it
     on `{{ .ConfirmationURL }}` and returning subscribers work while first-time
     ones are broken — the worst way for this to fail, because your own test
     account is not new.
   - **They build on `{{ .RedirectTo }}`, not `{{ .SiteURL }}`.** RedirectTo is
     the `emailRedirectTo` the app sent, which always carries `?next=…`, so a
     reader who clicked "Change what you follow" lands on `/app/subscriptions`
     rather than being dumped on `/app`. For that to survive, the callback must be
     listed under *Authentication → URL Configuration → Redirect URLs* — Supabase
     silently discards an unlisted RedirectTo and falls back to the Site URL.

     Two exact paths are all this project needs, and both belong there — the
     localhost one because signing in locally goes through the same flow:

     ```
     https://likelylist.tech/auth/callback
     http://localhost:3000/auth/callback
     ```

     Replace the default `http://localhost:3000/**` with the path above rather than
     keeping the wildcard. Matching is on scheme + host + path only, so query
     strings are ignored and the exact path still matches `?next=…`; `**` would
     additionally accept any other path on that port as a place to deliver an auth
     token, and `/auth/callback` is the only redirect target the app ever uses.
     Also set **Site URL** to `https://likelylist.tech`: it is the fallback target,
     and the templates build their footer links from `{{ .SiteURL }}`, so leaving it
     on localhost ships production emails whose links point at a dev server.
   - **`{{ .Token }}` is deliberately absent.** There is no code-entry screen in
     the app, so printing the six-digit code would be an invitation to a dead end.

   They carry no `<img>`: the app mark is drawn with coloured table cells, the same
   trick `src/lib/email/` uses, so it survives Classic Outlook and still reads with
   images blocked. A hosted SVG would not render in Gmail or Outlook at all — if
   you ever want a raster mark, export a PNG and host it, because `src/app/icon.svg`
   cannot be used directly.

   This matters because PKCE cannot work for an emailed link: the code verifier
   lives in the browser that *requested* it, and people click links from whatever
   their mail client opens. With a `code` in that situation Supabase fails with
   "both auth code and code verifier should be non-empty" — and since this is now
   the *only* way in, that failure is a lockout rather than an inconvenience.
   `/auth/callback` recognises a stray `code` and says exactly that, because a
   template left on `{{ .ConfirmationURL }}` is the one mistake this setup invites.
2. **Set Auth → SMTP to Resend.** Supabase's built-in sending service is rate
   limited to a handful of messages per hour and is not intended for production.
   Sign-in links are not marketing mail — a throttled one is an outage. Use the
   SMTP credentials from the Resend account you already configured above.

**You cannot turn password sign-in off, and should not try.** Supabase's Email
provider governs passwords and OTP/magic links together; there is no toggle that
separates them. Two settings look like the answer and both break the product:

- Disabling the **Email provider** switches off magic links, i.e. the only way in.
- Disabling **"Allow new users to sign up"** breaks first-time subscribers, because
  `/login` deliberately relies on `shouldCreateUser: true`.

It does not matter much, because nothing in the app sets a password any more —
there is no `signUp({ password })` and no reset flow, so no new account can acquire
one, and every anonymous subscriber has none by construction. The only accounts
with a usable password are old test ones; delete them or overwrite the password
with random bytes via the admin API. (`npm run security:check` still creates a
throwaway password account, which is another reason leaving this enabled is right.)
If you ever do need it enforced server-side, the only mechanism is the
`password_verification_attempt` auth hook returning `{"decision": "reject"}` — note
that it runs on unauthenticated requests.

**Resend:** add a **subdomain** (e.g. `mail.yourdomain.com`) rather than the apex,
so digest reputation cannot damage the root domain. Add the SPF and DKIM records
Resend gives you to Cloudflare DNS, plus a DMARC record. Verification is retried
for 72 hours. Until a domain is verified you can only send to your own address.

### 4. Database

Paste the files in `supabase/migrations/` into the Supabase **SQL Editor** and run
them one at a time, in order:

1. `0001_init.sql` — tables, RLS policies, the `auth.users` → `profiles` trigger
2. `0002_storage.sql` — the private `feeds` bucket and its ownership policies
3. `0003_queue.sql` — atomic queue claiming, lease recovery, cache purging
4. `0004_function_grants.sql` — revokes the SECURITY DEFINER functions from
   `anon`/`authenticated`. **Not optional.** PostgreSQL grants EXECUTE on new
   functions to PUBLIC, so without this any signed-in user could call
   `rpc/claim_digest_jobs` and permanently suppress every subscriber's email, or
   `rpc/bump_usage` to exhaust someone else's quota.
5. `0005_profile_hardening.sql` — restricts which `profiles` columns a user may
   write. Also not optional: `profiles.email` is the digest's delivery address, so
   a writable copy of it turns this into a relay for unsolicited mail.
6. `0006_feeds_are_music_screenshots.sql` — renames `feeds.not_an_event` and
   `feed_artists.role`, which described the flyer-only version of the feature.
7. `0007_pending_subscriptions.sql` — the double opt-in waiting room for
   signups that arrive without an account.
8. `0008_onsale.sql` — `events_cache.onsale_start` and its index, for the
   "on sale this week" section.
9. `0009_postal_codes.sql` — a permanent ZIP → coordinates cache.
10. `0010_places.sql` — every US place, so the city box can find any town. Seed it
    with `npm run seed:places` afterwards.
11. `0011_retention.sql` — `purge_stale_data()`. **Not optional on a free tier:**
    before it, five tables only ever grew.
12. `0012_spotify_links.sql` — the Spotify connection table, and a third
    `pref_source` value. Only needed if you configure Spotify.
13. `0013_pins.sql` — `pinned_events`, with per-user RLS policies rather than the
    deny-all the caches use.
14. `0014_subscribe_by_point.sql` — subscriptions become coordinates and
    `events_cache` is re-keyed by grid cell. **Truncates `events_cache`**, which is
    safe: it is a 36-hour scratch buffer the weekly run refills.

Run them one at a time, so a failure names the file that failed. They are one-shot
scripts — `create table` / `create policy` without `if not exists` — so re-running one
errors with "already exists". That is expected, not a problem.

Either paste them into the SQL editor, or use the CLI:

```bash
supabase link --project-ref <your-project-ref>
```

```bash
for f in supabase/migrations/*.sql; do supabase db query --linked -f "$f"; done
```

`db query --linked` goes through the Management API, so it needs the access token from
`supabase login` and **not** the database password. Note it is `db query`, not
`db push`: `push` expects `<timestamp>_name.sql` filenames and its own migration
history table, and these files are numbered `0001…` and applied once by hand. Renaming
them to the timestamp convention is the change to make if CLI-managed migrations ever
become worth the bookkeeping.

Then seed the reference data — the schema alone leaves the city, genre and place
pickers empty:

```bash
npm run seed:cities && npm run seed:genres && npm run seed:places
```

Afterwards, confirm the two things that are easy to get wrong:

```sql
-- Every table below must show rowsecurity = true.
select relname, relrowsecurity as rowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- Only bump_usage may be executable by `authenticated`; every other row must be false.
select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by p.proname;
```

Then seed the reference data:

```bash
npm run seed:cities
npm run seed:genres
```

`seed:genres` reads the taxonomy from Ticketmaster's live `/classifications`
endpoint. **The genre IDs are deliberately not in the codebase:** Ticketmaster
publishes no genre ID table and third-party lists contradict each other — they do
not agree even on the ID for "Rock" — so hardcoding them would silently filter on
the wrong genre. The only ID taken on faith is the Music segment,
`KZFzniwnSyZfZ7v7nJ`, which the official docs do state.

### 5. Run it

```bash
npm run dev
```

To run in the actual Workers runtime — the only way to exercise the cron handler:

```bash
npm run preview
```

---

## Continuous integration

Two workflows, in `.github/workflows/`.

**`ci.yml`** runs on every push and pull request: `typecheck`, `lint`, `test`, and the
Cloudflare build. It needs no secrets, because none of it touches the database or
spends a quota.

The build job is the one that cannot be replaced by a unit test. A passing
`next build` does not mean the adapter produced a worker — a `proxy.ts` in the tree
makes `opennextjs-cloudflare` emit nothing at all, silently — so the job builds and
then asserts `.open-next/worker.js` exists.

**`scheduled-checks.yml`** runs Thursday morning, the day before the send, and can be
triggered by hand. It runs `preflight` and `security:check` against the real project.
Thursday is the point: every credential here can expire without anybody touching the
code, and the way that currently surfaces is subscribers not getting an email.

It needs repository secrets — the same names as `.env.example` — set under an
environment called `production`. `security:check` writes to the live database (a
throwaway account it creates and deletes), which is why it is scheduled rather than
run on every push.

Two things are deliberately **not** on Actions:

- **The weekly send.** It already runs on Cloudflare cron, inside the Workers runtime
  and next to its data. A second scheduler pointed at the same queue is how an email
  gets sent twice.
- **Deploys.** `npm run deploy` stays a deliberate act; nothing here pushes to
  production on a merge.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server on :3000 |
| `npm run preview` | Build and serve in the local Workers runtime |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run preflight` | **The API viability check.** One cheap real request per service; reports which credentials actually work and what to fix |
| `npm run security:check` | Live RLS and column-privilege assertions against the real database, using a throwaway account it creates and deletes. Checks both directions — that a user cannot rewrite their delivery address, *and* that they can still change their timezone |
| `npm test` | Unit tests (`node:test` via `tsx`) |
| `npm run preview:email` | Render the digest email to `email-preview.html` with sample data, and report its size against Gmail's clip threshold |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run cf-typegen` | Regenerate `cloudflare-env.d.ts` after editing `wrangler.jsonc` |
| `npm run seed:cities` / `seed:genres` | Populate reference tables |

Before deploying, push the secrets:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

…and likewise for `OPENAI_API_KEY`, `TICKETMASTER_API_KEY`, `YOUTUBE_API_KEY`,
`RESEND_API_KEY`, `CRON_SECRET`, `UNSUBSCRIBE_HMAC_SECRET`. Generate the last two
with `openssl rand -hex 32`.

---

## How the weekly send works

```
Weekly cron  "0 19 * * 2"                Drain cron  "*/5 * * * *"
      │                                        │
      ├─ create digest_runs row                ├─ requeue jobs whose lease expired
      ├─ refresh genre taxonomy if stale       ├─ claim a small batch whose
      ├─ TWO Ticketmaster queries per         │   send_after has arrived
      │   DISTINCT subscribed city:           ├─ build + render + send each
      │   this week's shows, and what         ├─ purge expired event cache
      │   goes ON SALE this week              └─ finalise completed runs
      ├─ cache the events (short TTL)
      └─ queue one job per subscriber,
          each with its own send_after
```

Four decisions here are load-bearing and not obvious:

**Ticketmaster is queried per city, not per subscriber.** Two people following
Boston cost one API call. Genre filtering then happens in our own code against
each event's primary genre ID. Filtering server-side per user would multiply
requests by (users × genres) against a 5000/day quota for no benefit.

**The on-sale query filters on `onsaleOnAfterStartDate`, and the obvious parameter
is a trap.** Ticketmaster documents `onsaleStartDateTime` and `onsaleEndDateTime`;
both are accepted, both return 200, and both do nothing. Measured on one Boston
week via `npm run tm:probe`:

| Filter | Events returned | Actually on sale that week |
| --- | --- | --- |
| none (control) | 537 | 1 |
| `onsaleStartDateTime` + `onsaleEndDateTime` | 536 | 1 |
| `onsaleOnAfterStartDate` (date form) | **3** | **3** |

The first two rows matching is the tell. The section was built on the documented
pair first and would have shipped permanently empty — nothing errors, the query
just returns the same events it always did and our own window filter then discards
them. That comparison is now a permanent part of `tm:probe` so the same silence
cannot happen twice.

Consequences of using the date form: it has no upper bound, so the window's far
edge is applied in `buildDigest` rather than by the API; the event-date window
stays wide (a year) purely to bound the request, since a ticket drop this week is
usually for a show months out; and the result set is genuinely small — most listed
events are already on sale, so **expect zero to a handful of rows**, which is why
the section is capped at four and sheds first under the size budget.

Both queries write to the same `events_cache`, deduplicated by event ID before the
upsert — two rows with the same `(city_id, tm_event_id)` in one statement would
make Postgres reject the whole batch and lose that city's cache entirely, not just
the duplicate. Ticketmaster also returns `1900-01-01` as an "on sale since forever"
sentinel on roughly 8% of events, which is normalised to `NULL` so the column does
not lie about what it holds.

**The weekly cron only queues; the drainer sends.** Cloudflare caps a cron
invocation at 15 minutes of wall clock, so a single pass over every subscriber was
never safe to depend on. Running the drainer every five minutes makes the pipeline
self-healing — an invocation that dies leaves the rest queued — and it is also
what lets each subscriber be emailed at their *own* local hour, which handles
multiple timezones and daylight saving without touching the always-UTC cron
expression.

**Cron firing time drifts within the hour.** Cloudflare spreads scheduled work
across the hour it is triggered in. "Wednesday morning" is reliable; a precise
minute is not.

**The builder runs Tuesday, the sends land Wednesday.** Everyone is emailed on
their own local Wednesday morning, and the supported zones bound that span:
Tokyo (UTC+9) at 06:00 is Tuesday 21:00 UTC, Honolulu (UTC-10) at 11:00 is
Wednesday 21:00 UTC. Building at Tuesday 19:00 UTC sits two hours before the
earliest send — margin for the hour Cloudflare spreads a trigger across — and
the latest send is still 26 hours later, inside the 36-hour `events_cache` TTL
every job reads from. The weekday itself lives in `DIGEST_WEEKDAY`, not in the
cron expression: a run instant falls on different calendar days in different
zones, so reading the day off the clock is how a "Friday" email used to arrive
on a Thursday west of UTC-9.

Both passes can be driven by hand:

```bash
curl -X POST "http://localhost:3000/api/cron/digest?mode=weekly" -H "x-cron-secret: $CRON_SECRET"
```

A weekly run driven by hand is still keyed and queued for the *next* Wednesday,
not for the day you ran it — so on a Monday it queues sends four days out, and
the cache it just filled will have expired by then. Harmless in practice: the
Tuesday cron resumes the same run (same `run_date`) and refills the cache before
anything is sent. To see an email now, use the preview route instead.

Under `npm run preview`, the real scheduled handler can be fired with:

```bash
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+19+*+*+2"
```

---

## Verifying it end to end

Start here, as soon as the keys exist:

```bash
npm run preflight
```

It makes one deliberately cheap real request per service and tells you which
credentials work rather than which are merely set — including whether the address
in `EMAIL_FROM` is on a domain Resend has actually verified, which is the failure
that otherwise only shows up when real subscribers get nothing. It never sends
email, and it avoids YouTube's `search.list` because that has its own hard ceiling
of 100 calls a day for the whole project.

It also asserts two database facts that are easy to forget: that every migration
ran, and that `rpc/claim_digest_jobs` and `rpc/bump_global_usage` are no
longer callable with the public anon key.

Then, by hand:

- **The whole subscriber loop**, which is the one thing worth walking end to end,
  because every step of it used to be broken somewhere:
  1. Subscribe from the landing page with an address that has never been seen.
     It must refuse to submit with no genre picked.
  2. Confirm from the email. `POST` creates the account; a `GET` of the same link
     must *not*, because mail scanners fetch every URL in a message.
  3. Confirming should land you on `/app/subscriptions` **already signed in** — no
     second email, no typing your address again. You proved you hold the mailbox
     by clicking the link, and asking for that proof twice was the friction this
     removed. A `profiles` row exists by now (created by a database trigger, not
     by app code).
  4. Sign out, go to `/login`, enter **that same address** and follow the link you
     are sent. It has to land you in `/app`, not on an error. This is the step
     that was impossible before magic links: the account has no password.
  5. Repeat step 4 with an address Supabase has **never seen**, which is served by
     the "Confirm sign up" template rather than the magic-link one.
  6. Click **Change what you follow** in a digest, in a browser with no session.
     It should land on `/app/subscriptions` after one link, not dump you on a
     bare sign-in page having forgotten where you were going.
- **Genres** — after `npm run seed:genres`, check `genres` holds real Ticketmaster
  IDs and that `tm_segment_id` is `KZFzniwnSyZfZ7v7nJ`.
- **Artists** — search for a band on `/app/subscriptions` and follow it, then
  **Build it now**: its shows should appear with "because you follow …", including
  in a genre you do *not* follow. `usage_counters` gets an `artist_search` row.
- **Never-empty digest** — unfollow every genre, keep a city, and build again. You
  should get an unfiltered list of that city with a banner saying so, **not**
  "Nothing matched this week". Check the plain-text part carries the same
  disclosure; presenting an unfiltered list as a filtered one is the failure this
  guards against.
- **On sale** — confirm `events_cache.onsale_start` is populated after a weekly
  run, and that the section renders above the listings with times in the
  subscriber's timezone. Set a test account to `America/Los_Angeles` and check a
  10am-Eastern drop reads as 7am.
- **Feeds** — upload a few music-app screenshots plus one image with nothing to do
  with music. The last should return `not_music_related: true` and change nothing.
  Confirm
  `feeds.image_path` stays `NULL` on success — the image is only ever persisted
  when extraction *fails*, so a retry does not need you to find the screenshot
  again — and that `usage_counters` increments.
- **Digest** — follow a city and a genre, then use **Build it now** on the
  Overview page. It reports the rendered email size against Gmail's clipping
  threshold, which is the one property you cannot check by eye.
- **Email** — use **Email it to me**, then in Gmail verify: `List-Unsubscribe`
  carries *both* the `https` and the `mailto` form; the body is under 100 KB (no
  "show trimmed content"); the message is fully readable with images disabled; and
  the Ticketmaster thumbnails actually load.
- **One-click unsubscribe** — `curl -X POST "$SITE/unsubscribe?t=<token>"` should
  flip `digest_enabled` with no confirmation page. A plain `GET` of the same URL
  must *not* unsubscribe — it returns a confirm button, because email security
  scanners fetch every link in a message.
- **Timezones** — set a test account to `Asia/Taipei` and confirm the drainer does
  not release its job during the US morning.
- **Failure recovery** — break `RESEND_API_KEY` temporarily and confirm the next
  drain pass retries that job rather than the whole batch stalling.
- **Column lockdown** — signed in, try to change your own email directly against
  PostgREST. It must be refused:
  ```bash
  curl -X PATCH "$SUPABASE_URL/rest/v1/profiles?id=eq.$USER_ID" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" \
    -H "Content-Type: application/json" \
    -d '{"email":"someone-else@example.com"}'
  ```
- **Open redirect** — `/auth/callback?next=/\evil.com` must land on `/app`, not on
  another origin. Covered by `src/lib/safe-redirect.test.ts` as well.

What can be verified without live credentials: the full unit suite (headliner
inference, timezone/DST arithmetic, the strict extraction schema, token signing,
and the email's size/attribution/images-off properties), `typecheck`, `lint`, an
`opennextjs-cloudflare build`, and the cron path in the real Workers runtime —
the scheduled handler reaches `/api/cron/digest`, authenticates, and returns a
structured error naming the missing credential. Everything past that point needs
real API keys.

---

## Known limitations

These are real constraints, not forgotten to-dos.

**Support acts are not reliably available.** Ticketmaster's schema has no billing
order, no role field and no headliner flag; array order in
`_embedded.attractions` is neither documented nor guaranteed, and the official docs
contain no example of a multi-act bill at all. In practice many concerts return
only the headliner. So `likelylist` infers the headliner by matching performer names
and aliases against the event title, and labels everyone else **"same bill"** —
never "opening act". Real lineups would require a second source (Bandsintown,
Songkick) plus cross-source artist-name alignment.

**No `proxy.ts`.** Supabase auth conventionally refreshes its token in Next's
middleware, now called Proxy. That is impossible here: Next 16 runs Proxy on the
Node.js runtime and forbids opting into Edge (setting `runtime` in a Proxy file
throws), and `@opennextjs/cloudflare` does not support Node middleware — with a
`proxy.ts` present the Cloudflare build produces no worker at all
([issue #962](https://github.com/opennextjs/opennextjs-cloudflare/issues/962)).
Refresh is done from the browser instead, in `src/components/session-sync.tsx`.
The residual gap: a hard navigation made after the access token has expired can
render one server pass without a session and briefly bounce to `/login`, from
where the refresh completes and moves you into the app. Revisit if the adapter
adds support.

**United States only.** Most of Europe is served by a separate International
Discovery API whose attraction objects carry no `externalLinks` and no
classification IDs, so genre filtering there would need a different mechanism.

**On-sale coverage is thin, and that is the data, not the code.** Most listed events
are already on sale, so a city typically has only a handful of upcoming drops —
three for Boston on the week this was measured. Many events carry no
`sales.public.startDateTime` at all, or flag it TBD/TBA, or return the
`1900-01-01` sentinel; presales are not distinguished from the general onsale
either, so the section cannot warn about a presale code you would actually need. It
shows what has been announced, not everything that will happen, and it cannot help
with a show that never appears on Ticketmaster. An empty section is the normal
resting state, not a bug — `npm run tm:probe` is how to tell the difference.

**A subscriber with no preferences gets an unfiltered list, labelled as one.** The
alternative is worse: `buildDigest` filters on genre weight and followed artists, so
someone with neither would otherwise receive a technically-correct "Nothing matched
this week" every week forever. The banner says plainly that this is everything
listed in their cities. It deliberately does not call it a "top shows" or "popular"
list — Ticketmaster exposes no popularity or listing-count signal, the same gap that
makes `genre-ranking.ts` a hand-curated list.

**Workers Paid is a hard requirement.** If the account ever drops to the free
plan, the send breaks on the CPU and subrequest limits rather than degrading.

**Cron timing drifts within the hour** (see above).

**Genre order is hand-ranked, not measured.** Ticketmaster exposes no popularity
or listing-count signal, and alphabetical order buried Rock, Pop and Hip-Hop below
Alternative and Blues. `src/lib/ticketmaster/genre-ranking.ts` is therefore a
curated list — a judgement call about US live inventory, stated plainly so nobody
assumes it came from an API. Anything not on the list sorts alphabetically after
everything that is, so a taxonomy change can never drop a genre from the picker.

**No Content-Security-Policy beyond `frame-ancestors`.** A real CSP needs a
nonce-based rollout verified against every page; shipping a guessed one breaks the
app. The other standard headers are set in `next.config.ts`.

**No Spotify artwork**, by choice (see Setup step 3).

**The `mailto` unsubscribe form is off by default, on purpose.** There are three
ways out of the list and they are not equally expensive:

1. The link in the email body. Covers everyone, always on, nothing to run.
2. `List-Unsubscribe` with the `https` one-click form. Gives Gmail its native
   unsubscribe button. Always on, still nothing to run.
3. `List-Unsubscribe` with the `mailto` form. The only one Outlook and iOS Mail
   read, so it is what makes *their* native button appear — but it works by having
   the mail client send an email, which means running an inbound mailbox.

(3) is implemented — Cloudflare Email Routing forwards to the Worker's `email()`
handler, which posts to `/api/inbound/unsubscribe` — but it stays dormant until
`EMAIL_UNSUBSCRIBE_MAILTO` is set. Leaving it unset is the right call at low volume:
those readers simply use the body link. Turn it on when subscriber numbers make the
missing native button worth an extra moving part.

**No open tracking.** Gmail's image proxy fetches every image when the message is
delivered, before any human opens it, so open rates would be noise.

**Flyer reading is imperfect.** Every extraction is confirmed by the user before it
touches a preference, and text inside an image is treated strictly as content to
transcribe — never as an instruction — so a screenshot cannot direct the system.

---

## Launch checklist

Ordered so nothing waits on something later in the list.

- [ ] Workers Paid active on the Cloudflare account
- [ ] Nameservers pointed at Cloudflare, zone shows **Active**
- [ ] DNSSEC disabled at the registrar *before* the nameserver switch
- [ ] Migrations `0001`–`0014` all applied
- [ ] `npm run seed:cities`, `npm run seed:genres` and `npm run seed:places` run
- [ ] YouTube Data API v3 enabled and its key set (no OAuth client needed)
- [ ] ⚠️ **Supabase Auth → SMTP set to Resend.** The built-in sender is rate
      limited to a handful of messages an hour, and sign-in links are now the only
      way in — a throttled one is a lockout, not a delay
- [ ] **Both** the "Magic link or OTP" *and* "Confirm sign up" templates pointed at
      `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=…`, as the files in
      `supabase/email-templates/` do — **not** `{{ .ConfirmationURL }}`, which
      produces a `code` that cannot be exchanged from a different browser, and
      **not** `{{ .SiteURL }}` with a hardcoded `next`, which throws away the
      `next` the app sent and so breaks every flow that resumes after sign-in
      (currently: the digest's in-app links, and the landing page's Spotify
      button). The signup one is what a first-time address actually receives
- [ ] **Site URL** is the real domain, and *Redirect URLs* holds the two exact
      `/auth/callback` paths with the default `http://localhost:3000/**` wildcard
      removed. A stale Site URL is silent: the templates build their footer links
      from it
- [ ] A link requested at `/login` arrives and signs you in, tested twice: once
      with an address that has **no** password (one created by anonymous
      subscribe), and once with an address Supabase has **never seen**, which
      exercises the "Confirm sign up" template
- [ ] Left alone on purpose: password sign-in cannot be disabled separately from
      magic links, and neither the Email provider nor "Allow new users to sign up"
      may be switched off — see *Accounts* above
- [ ] Sending subdomain verified in Resend, SPF + DKIM + DMARC in Cloudflare
      DNS, every CNAME set to **DNS only** (grey cloud)
- [ ] `EMAIL_FROM` is an address on that verified subdomain — there is no default
      sender, so a missing or unverified value fails the send rather than quietly
      delivering from somewhere else
- [ ] `help@likelylist.tech` routed to a real inbox in Email Routing — `/privacy`
      publishes it as the contact for corrections and erasure requests, so an
      unrouted address turns a legal commitment into a bounce
- [ ] All secrets pushed with `wrangler secret put`
- [ ] ⚠️ **Build with production environment values, not `.env.local`.** `robots.txt`
      and `sitemap.xml` are prerendered and `metadataBase` in `src/app/layout.tsx`
      is read at module load, so `NEXT_PUBLIC_SITE_URL` is baked in at build time —
      building with the localhost value ships a sitemap *and every canonical tag*
      pointing at `http://localhost:3000`. `wrangler secret put` sets *runtime*
      values only
- [ ] Search Console: property added, `sitemap.xml` submitted, URL Inspection run
      live against `/`, `/?lang=zh-Hant` and `/explore`; International Targeting
      reports no `hreflang` errors
- [ ] `npm run preflight` clean against production values
- [ ] `npm run typecheck && npm run lint && npm test` clean
- [ ] Test digest received, checked in Gmail for both `List-Unsubscribe` forms,
      under 100 KB, readable with images off
- [ ] One-click unsubscribe verified with a real `POST`
- [ ] Workers custom domain bound; `/privacy` reachable; `/robots.txt` disallows
      `/preview/` and `/unsubscribe`
- [ ] Cron triggers visible in the Cloudflare dashboard after deploy

---

## Source layout

```
worker.ts                    Worker entry: OpenNext fetch + scheduled + email
wrangler.jsonc               Bindings and the two cron triggers
supabase/migrations/         Schema, RLS, storage policies, queue functions, grants
supabase/email-templates/    Auth emails to paste into the Supabase dashboard
scripts/                     Seeders, preflight, security-check, Ticketmaster probe
src/
  app/
    page.tsx                 Landing page, with anonymous subscribe
    explore/                 Public listings by city or ZIP, no account
    subscribe/confirm/       Double opt-in confirmation, opened from an inbox
    unsubscribe/             RFC 8058 one-click endpoint, standalone by design
    preview/digest/[token]/  Web version of the email, opened from an inbox
    privacy/                 Privacy policy — required by Ticketmaster's terms
    dev-mode/                Sets the cookie that reveals raw error detail
    robots.ts sitemap.ts     Keep token-bearing URLs out of search indexes
    login/                   One email field. No password, by design
    auth/callback/           Verifies both an OAuth `code` and a magic-link hash
    app/                     Signed-in area: feed, pinned, subscriptions, feeds,
                             settings
    api/                     feeds, explore, subscribe, artist search, cron,
                             inbound unsubscribe
  components/
    session-sync.tsx         Browser-side auth refresh (stands in for proxy.ts)
    anonymous-subscribe.tsx  Shared signup box (landing + explore)
    service-icon.tsx         Official YouTube / Spotify marks, unmodified
  lib/
    digest/                  plan → build → send, and the queue drainer
    email/                   react-email templates and the size-budgeted renderer
    ticketmaster/            Client, classifications, events, headliner inference,
                             genre-ranking (curated popularity order)
    vision/                  Strict extraction schema, OpenAI provider, preprocessing
    feeds/apply.ts           Merges a confirmed extraction into preferences
    subscribe/anonymous.ts   Double opt-in: request, confirm, rate limits
    enrich/                  Quota-aware YouTube lookup, Spotify/YouTube links
    supabase/                Request-scoped (RLS) and service-role clients
    i18n/                    Locales and strings for the inbox-facing pages
    errors.ts api-error.ts   AppError and the single route error responder
    dev-mode.ts              Per-browser flag for showing raw detail
    tokens.ts                HMAC links for unsubscribe, preview and confirm
    safe-redirect.ts         Same-origin redirect validation (open-redirect guard)
    standalone-page.ts       Dependency-free HTML for the inbox-facing pages
    region.ts geohash.ts     Timezone→metro guess; geoPoint encoding
    site-url.ts              Origin only, for pages that must not need credentials
    time.ts                  Timezone and DST arithmetic
```
