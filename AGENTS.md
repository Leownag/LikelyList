<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Pitfalls already hit — do not rediscover these

Each of these cost real time once. They are recorded so the next person does not
pay for them twice.

## Platform

**`proxy.ts` must not exist in this project.** Next 16 renamed `middleware.ts` to
`proxy.ts` and runs it on the Node runtime with no way to opt into Edge (setting
`runtime` throws). `@opennextjs/cloudflare` does not support Node middleware, and
with a `proxy.ts` present **the build emits no worker at all**
([issue #962](https://github.com/opennextjs/opennextjs-cloudflare/issues/962)).
Supabase session refresh therefore lives in `src/components/session-sync.tsx`,
browser-side. Residual gap: a hard navigation after the access token expires can
render one server pass unauthenticated and bounce to `/login`, from where the
refresh completes.

**`opennextjs-cloudflare build` can exit 0 and still have failed.** It printed
`ERROR Node.js middleware is not currently supported` and returned 0. **Always check
`.open-next/worker.js` exists** rather than trusting the exit code.

**Pages that read the database must be `force-dynamic`.** The landing page and
`/explore` were being statically prerendered, which baked in whatever the city query
returned at build time — an empty list on a build without credentials, so the
subscribe box silently vanished. Both now declare `export const dynamic = "force-dynamic"`.

**`robots.txt` and `sitemap.xml` bake `NEXT_PUBLIC_SITE_URL` at build time.**
`wrangler secret put` sets *runtime* values only, so building with `.env.local`
ships a sitemap pointing at localhost.

**Workers free tier cannot run this** — 10 ms CPU and 50 subrequests per invocation.
Needs Workers Paid.

## Postgres / Supabase

**A column-level `REVOKE` cannot subtract from a table-wide `GRANT`.** Granting
UPDATE on a table covers every column. To restrict columns you must
`revoke update on <table>` first, then `grant update (col, col)`. Migration 0005 does
this for both UPDATE and INSERT; the first attempt at INSERT was decorative until
fixed.

**SECURITY DEFINER functions in `public` are RPC-callable by default.** Postgres
grants EXECUTE to PUBLIC on new functions and Supabase gives `anon`/`authenticated`
USAGE on the schema, so every helper was reachable at `/rest/v1/rpc/<name>` with the
definer's privileges. Migration 0004 revokes them. Any **new** function needs the
same treatment — 0004 also sets `alter default privileges` to stop it recurring, but
that only applies to functions created by the same role.

**PostgREST answers an RLS-filtered UPDATE with 200 and `[]`.** A successful-looking
response can mean nothing changed. `scripts/security-check.ts` therefore writes and
then **reads the value back with the service role** rather than trusting the status.

**`auth.uid()` works under `set search_path = ''`** because it is schema-qualified.
Handy — `bump_usage`'s caller guard depends on it.

## React / email

**React SSR inserts `<!-- -->` between adjacent text nodes.** `+ {n} more` rendered
as `+ <!-- -->8<!-- --> more`. Interpolate one string instead.

**Do not `setState` in an effect to capture a browser-only value.** ESLint's
`react-hooks/set-state-in-effect` catches it and it causes cascading renders. Use
`useSyncExternalStore` with a server snapshot — see `src/lib/use-detected-region.ts`.
The snapshot must be cached at module scope or React loops.

**Gmail clips a body over 102 KB and hides everything below it** — including the
unsubscribe link. Ten events with four performers each and nested per-performer
tables came to 130 KB. Fixed by flattening the performer row, dropping the
per-performer thumbnail (each card already has a hero image, and Gmail fetches every
image on delivery), and `MAX_EMAIL_PERFORMERS = 3`. **If you raise
`MAX_EMAIL_EVENTS` again, the size test is the authority.**

**`alt=""` is correct for a decorative image.** The brand marks sit next to real
text labels, so an empty alt is the right accessible choice — a test asserting
"every image has non-empty alt" was wrong, not the markup.

## External APIs

**Ticketmaster ignores `radius` with both `city` and `postalCode`.** Measured, not
guessed: Boston 21 → 21 with radius; ZIP 02134 2 → 2 → 2 at 25 and 50 miles. Radius
only takes effect with coordinates (`geoPoint`, a geohash; `latlong` is deprecated).

**Ticketmaster publishes no billing order.** No role, no headliner flag, and
`_embedded.attractions` order is not guaranteed. The headliner is *inferred* from the
event title, and everyone else is labelled "same bill" — never "opening act". Tests
enforce this wording.

**Ticketmaster genre IDs are not published and third-party lists disagree.** Always
read them from `/classifications`. Live taxonomy: **24 genres, 929 subgenres** under
the Music segment (`KZFzniwnSyZfZ7v7nJ`, the one ID the docs do state). Only genres
are seeded; subgenres are unused.

**`city=Boston` returns Boston-proper venues only** — 21 music events in a week,
while all segments returns 97 (47 of them hockey). Cambridge and Somerville shows are
invisible. Genre-level filtering is *not* the problem: Rock's six events span four
subgenres but share one genre ID.

**Do not set `temperature`.** Newer OpenAI models accept only the default and return
`400 Unsupported value: 'temperature' does not support 0`. This reached a user.
Constrained decoding already pins the output shape.

**Array `.max()` cannot go in the OpenAI strict schema** (`maxItems` unsupported).
Cap at the application layer instead — `MAX_ARTISTS_PER_FEED` in `lib/feeds/apply.ts`.

**YouTube `search.list` is 100 *calls* per day in its own bucket** (changed
2026-06-01), not 100 units from the 10,000 pool. Artist → channel mappings are cached
permanently for this reason. `preflight` uses `videos.list` to avoid touching it.

**Spotify's API is deliberately unused** — since Feb 2026 a Development Mode app
requires its owner to hold Premium. Links go to `open.spotify.com/search/…`. Useful
side effect: no expiring `i.scdn.co` image URLs in email.

**Do not redraw the YouTube or Spotify logos in the site's pixel style.** Both brand
guidelines forbid modified marks. Use the official unmodified assets from
`public/brand/`, always with a text label beside them.

## Own mistakes worth remembering

- A `perl -pi -e` rename ate `${userId}` because `$` interpolates in the replacement.
- Several test assertions were too broad and failed on correct code: a footer that
  legitimately says "rather than as opening acts"; `alt=""` on decorative images;
  a hard-coded performer count after the cap changed. **When a test fails, check
  whether the assertion or the code is wrong.**
- `renderWithinSizeBudget` trimmed events *above* the display cap, which was a
  no-op — the template only ever renders `MAX_EMAIL_EVENTS`.
