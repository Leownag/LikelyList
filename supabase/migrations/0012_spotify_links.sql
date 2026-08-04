-- ---------------------------------------------------------------------------
-- Spotify: one row per connected account
-- ---------------------------------------------------------------------------
--
-- The whole integration does one thing: read the reader's top 50 artists and put
-- them in `artist_prefs`. No playlists, no images, no genre analysis, no audio
-- features. That narrowness is the design — the screenshot reader already exists for
-- everything fuzzier, and the only question this answers is "who do you actually
-- listen to", which Spotify can answer exactly.
--
-- Which is also why the scope requested is `user-top-read` and nothing else. A token
-- that cannot read a playlist cannot leak one.
--
-- The refresh token is the sensitive part. It lives here rather than in `profiles`
-- for two reasons: `profiles` is readable by its owner under RLS, and migration 0005
-- went to some trouble to control which of its columns a user may write. A separate
-- deny-all table keeps a long-lived credential off any path a browser can reach.

create table public.spotify_links (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  -- Long-lived. Spotify does not expire refresh tokens on a timer, but it does
  -- invalidate them when the user revokes access, which is the case the importer has
  -- to handle gracefully rather than retry.
  refresh_token     text not null,
  -- Spotify's own user id, kept only so a support question ("which account did I
  -- connect?") is answerable without another API call.
  spotify_user_id   text,
  -- What was actually granted. Stored because a scope can be narrowed by the user at
  -- the consent screen, and an importer that assumes it got what it asked for fails
  -- confusingly.
  scope             text,
  connected_at      timestamptz not null default now(),
  last_imported_at  timestamptz,
  -- Set when a refresh fails in a way that will not fix itself — a revoked grant.
  -- The UI reads this to offer a reconnect instead of silently importing nothing.
  invalid_since     timestamptz,
  last_error        text,
  -- How many artists the last run wrote. Purely so the UI can say something true.
  last_artist_count integer
);

-- Reached only through the service role. RLS on with no policy = deny all, which for
-- a table holding a refresh token is the entire point.
alter table public.spotify_links enable row level security;

-- The importer's due-work query: rows never imported, or imported over 30 days ago,
-- excluding the ones whose grant is known to be dead.
create index spotify_links_due_idx
  on public.spotify_links (last_imported_at)
  where invalid_since is null;

-- ---------------------------------------------------------------------------
-- artist_prefs gains a third source
-- ---------------------------------------------------------------------------
--
-- `pref_source` was ('explicit', 'feed'). A Spotify import is neither: it is not the
-- reader naming an artist, and it is not a screenshot being read. It needs its own
-- value so a re-import can overwrite what it wrote last month without touching a
-- name the reader typed in by hand — see followArtist and importTopArtists.

-- Last statement on purpose. Postgres will not let a transaction use an enum value it
-- added itself, so anything writing 'spotify' has to come from a later connection —
-- which is the application, after this migration has committed.
alter type public.pref_source add value if not exists 'spotify';
