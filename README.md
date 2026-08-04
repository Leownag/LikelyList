# likelylist

**[likelylist.tech](https://likelylist.tech)** — a weekly Friday email of upcoming
concerts, filtered by the cities and genres you follow and by the show flyers you
paste in.

- **Listings** come from the Ticketmaster Discovery API (US only).
- **Preferences** come from two places: cities and genres you pick explicitly, and
  artists/genres inferred from screenshots you feed it.
- **Feeds** are read by an OpenAI vision model under a strict JSON schema, and
  every extraction is shown to you for confirmation before it changes anything.
- **Delivery** is one email per subscriber per week, released when that
  subscriber's own local clock reaches their chosen hour.

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
| Cron (`0 8 * * 5`, `*/5 * * * *`) | `scheduled` | `/api/cron/digest` |
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
digest/plan.ts    once a week: query Ticketmaster per distinct city, cache
                  events, queue one job per subscriber with its own send_after
digest/drain.ts   every 5 min: claim due jobs atomically, recover expired leases
digest/build.ts   per subscriber: score cached events against their cities,
                  genres and artist preferences
email/render.tsx  react-email → HTML + plain text, measured against Gmail's
                  102 KB clip threshold
digest/send.ts    Resend, with both List-Unsubscribe forms
```

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
| [Google Cloud](https://console.cloud.google.com/) | OAuth client ID/secret **and** a YouTube Data API v3 key | One project, two credentials. The YouTube API must be enabled manually. |
| [Resend](https://resend.com) | API key + a verified sending domain | Needs the domain from step 2. |

Spotify is **not** used. Since February 2026 a Spotify app in Development Mode
stops working unless its owner holds an active Premium subscription, so linking out
via `open.spotify.com/search/…` is both free and unbreakable. The side effect is
convenient: all artwork comes from Ticketmaster's CDN, whose URLs are stable,
rather than Spotify's, whose URLs expire — which matters when an email sits in an
inbox for weeks.

**Supabase Auth:** enable the Google provider, and in Google Cloud set the
authorised redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.

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

Run them separately rather than as one paste, so a failure names the file that
failed. They are one-shot scripts — `create table` / `create policy` without
`if not exists` — so re-running one errors with "already exists". That is
expected, not a problem.

The Supabase CLI is not used here. `supabase db push` expects
`<timestamp>_name.sql` filenames and a linked project, and `supabase start` needs
Docker for a local Postgres — none of which buys anything for a handful of scripts
run once against a single environment. Rename the files to the timestamp
convention if CLI-managed migrations become worthwhile.

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
Friday cron  "0 8 * * 5"                 Drain cron  "*/5 * * * *"
      │                                        │
      ├─ create digest_runs row                ├─ requeue jobs whose lease expired
      ├─ refresh genre taxonomy if stale       ├─ claim a small batch whose
      ├─ query Ticketmaster ONCE per          │   send_after has arrived
      │   DISTINCT subscribed city            ├─ build + render + send each
      ├─ cache the events (short TTL)         ├─ purge expired event cache
      └─ queue one job per subscriber,        └─ finalise completed runs
          each with its own send_after
```

Three decisions here are load-bearing and not obvious:

**Ticketmaster is queried per city, not per subscriber.** Two people following
Boston cost one API call. Genre filtering then happens in our own code against
each event's primary genre ID. Filtering server-side per user would multiply
requests by (users × genres) against a 5000/day quota for no benefit.

**The Friday cron only queues; the drainer sends.** Cloudflare caps a cron
invocation at 15 minutes of wall clock, so a single pass over every subscriber was
never safe to depend on. Running the drainer every five minutes makes the pipeline
self-healing — an invocation that dies leaves the rest queued — and it is also
what lets each subscriber be emailed at their *own* local hour, which handles
multiple timezones and daylight saving without touching the always-UTC cron
expression.

**Cron firing time drifts within the hour.** Cloudflare spreads scheduled work
across the hour it is triggered in. "Friday morning" is reliable; a precise minute
is not.

Both passes can be driven by hand:

```bash
curl -X POST "http://localhost:3000/api/cron/digest?mode=weekly" -H "x-cron-secret: $CRON_SECRET"
```

Under `npm run preview`, the real scheduled handler can be fired with:

```bash
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+8+*+*+5"
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

- **Auth** — sign up once with email/password and once with Google; both should
  produce a `profiles` row (created by a database trigger, not by app code).
- **Genres** — after `npm run seed:genres`, check `genres` holds real Ticketmaster
  IDs and that `tm_segment_id` is `KZFzniwnSyZfZ7v7nJ`.
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
- [ ] Migrations `0001`–`0007` all applied
- [ ] `npm run seed:cities` and `npm run seed:genres` run
- [ ] Google OAuth redirect URI set to the Supabase callback; Google provider on
- [ ] Sending subdomain verified in Resend, SPF + DKIM + DMARC in Cloudflare
      DNS, every CNAME set to **DNS only** (grey cloud)
- [ ] `EMAIL_FROM` moved off `resend.dev`
- [ ] All secrets pushed with `wrangler secret put`
- [ ] ⚠️ **Build with production environment values, not `.env.local`.** `robots.txt`
      and `sitemap.xml` are prerendered, so `NEXT_PUBLIC_SITE_URL` is baked in at
      build time — building with the localhost value ships a sitemap pointing at
      `http://localhost:3000`. `wrangler secret put` sets *runtime* values only
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
    app/                     Signed-in area: overview, subscriptions, feeds, settings
    api/                     feeds, explore, subscribe, cron, inbound unsubscribe
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
