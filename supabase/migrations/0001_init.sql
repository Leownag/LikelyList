-- likelylist — initial schema
--
-- Run this in the Supabase SQL editor (or `supabase db push` if you use the
-- CLI). Everything a browser session can reach is behind RLS keyed on
-- auth.uid(); the weekly cron uses the service role key and bypasses it.

-- ---------------------------------------------------------------------------
-- Reference data (no RLS writes — seeded by scripts/, readable by everyone)
-- ---------------------------------------------------------------------------

-- Cities the user can subscribe to. `tm_city` is the exact string handed to
-- Ticketmaster's `city` parameter, which is not always the display name.
create table public.cities (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  name          text not null,
  tm_city       text not null,
  state_code    text,
  country_code  text not null default 'US',
  dma_id        integer,
  latitude      double precision,
  longitude     double precision,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now()
);

-- Music genres, seeded from Ticketmaster's /classifications endpoint.
--
-- These IDs are NOT hardcoded anywhere in the app: Ticketmaster does not
-- publish a genre ID table, and third-party sources contradict each other on
-- which ID means which genre. scripts/seed-genres.ts enumerates the live API
-- instead. The Music segment ID (KZFzniwnSyZfZ7v7nJ) is the one value the
-- official docs do state.
create table public.genres (
  id            bigint generated always as identity primary key,
  tm_genre_id   text not null unique,
  tm_segment_id text not null,
  name          text not null,
  slug          text not null unique,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now()
);

alter table public.cities enable row level security;
alter table public.genres enable row level security;

create policy "cities are readable by everyone"
  on public.cities for select using (true);
create policy "genres are readable by everyone"
  on public.genres for select using (true);

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,
  -- IANA zone. Drives *when* the Friday email is sent: the weekly cron only
  -- enqueues, and the drainer releases each job once this user's local clock
  -- reaches digest_send_hour. Handles multi-timezone users and DST without
  -- ever touching the (always-UTC) cron expressions.
  timezone          text not null default 'America/New_York',
  digest_send_hour  smallint not null default 8
                      check (digest_send_hour between 0 and 23),
  digest_enabled    boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "own profile is readable" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile is updatable" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- A profile row must exist for every account regardless of how it came to be —
-- an emailed sign-in link and an admin-created row from the anonymous subscribe
-- flow both land in auth.users — so create it from a trigger rather than from
-- application code, which would have to remember at every entry point.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Subscriptions and preferences
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  city_id     bigint not null references public.cities (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, city_id)
);

create index subscriptions_user_idx on public.subscriptions (user_id);
create index subscriptions_city_idx on public.subscriptions (city_id);

-- Genre interest. `source` separates what the user explicitly asked for from
-- what was inferred from their feeds, so the UI can show the two differently and
-- the user can always override an inference.
create type public.pref_source as enum ('explicit', 'feed');

create table public.genre_prefs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  genre_id    bigint not null references public.genres (id) on delete cascade,
  weight      real not null default 1.0 check (weight >= 0),
  source      public.pref_source not null default 'explicit',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, genre_id)
);

create index genre_prefs_user_idx on public.genre_prefs (user_id);

-- Artist-level interest, accumulated from feeds. Keyed on a normalised name
-- because a feed may name an artist Ticketmaster has never heard of.
create table public.artist_prefs (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  name              text not null,
  normalized_name   text not null,
  tm_attraction_id  text,
  score             real not null default 1.0,
  source            public.pref_source not null default 'feed',
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (user_id, normalized_name)
);

create index artist_prefs_user_idx on public.artist_prefs (user_id);
create index artist_prefs_tm_idx on public.artist_prefs (tm_attraction_id)
  where tm_attraction_id is not null;

alter table public.subscriptions enable row level security;
alter table public.genre_prefs   enable row level security;
alter table public.artist_prefs  enable row level security;

create policy "own subscriptions" on public.subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own genre prefs" on public.genre_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own artist prefs" on public.artist_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Feeds (pasted / uploaded screenshots)
-- ---------------------------------------------------------------------------

create type public.feed_status as enum ('pending', 'processing', 'done', 'failed');

create table public.feeds (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  status          public.feed_status not null default 'pending',
  -- Path in the `feeds` storage bucket, set ONLY when extraction failed and the
  -- bytes were retained so the user does not have to find the screenshot again.
  -- On the happy path the image is never written to storage at all: it lives in
  -- memory for the length of one request, and only the structured result is kept.
  image_path      text,
  model           text,
  -- Everything the extractor produced, including its own raw_text passthrough
  -- and per-field confidence, so the correction UI can show what it saw.
  extracted       jsonb,
  confidence      real,
  -- True when the image was not a show flyer at all. Recorded rather than
  -- discarded so the UI can explain why nothing was learned.
  not_an_event    boolean not null default false,
  -- Set once the user has confirmed/corrected the extraction and the
  -- preferences have been applied. Extraction alone never moves preferences.
  applied_at      timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);

create index feeds_user_idx on public.feeds (user_id, created_at desc);

create table public.feed_artists (
  id                bigint generated always as identity primary key,
  feed_id           uuid not null references public.feeds (id) on delete cascade,
  name              text not null,
  normalized_name   text not null,
  -- 'headliner' | 'support' | null. Comes from the vision model reading the
  -- flyer's layout, which is the only place billing order is ever available —
  -- Ticketmaster does not expose it.
  role              text,
  tm_attraction_id  text,
  tm_genre_id       text,
  created_at        timestamptz not null default now(),
  unique (feed_id, normalized_name)
);

alter table public.feeds        enable row level security;
alter table public.feed_artists enable row level security;

create policy "own feeds" on public.feeds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own feed artists" on public.feed_artists
  for all using (
    exists (
      select 1 from public.feeds f
      where f.id = feed_artists.feed_id and f.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.feeds f
      where f.id = feed_artists.feed_id and f.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Caches
-- ---------------------------------------------------------------------------

-- Artist cache. The YouTube columns are the important part: search.list is
-- capped at 100 CALLS per day in its own quota bucket, so an artist must cost
-- at most one search ever. Channel IDs do not change, so this row is permanent
-- even though the metadata around it is refreshed.
create table public.artists (
  tm_attraction_id            text primary key,
  name                        text not null,
  normalized_name             text not null,
  tm_url                      text,
  image_url                   text,
  tm_genre_id                 text,
  -- Ticketmaster documents this as a map of provider -> link array but never
  -- enumerates the provider keys and never shows a populated example, so it is
  -- stored whole and read defensively.
  external_links              jsonb,
  youtube_channel_id          text,
  youtube_uploads_playlist_id text,
  youtube_video_id            text,
  -- Set even when the lookup found nothing, so quota is never re-spent on a
  -- miss. Nullable means "never looked".
  youtube_looked_up_at        timestamptz,
  refreshed_at                timestamptz not null default now()
);

create index artists_normalized_idx on public.artists (normalized_name);

-- Weekly event cache.
--
-- Ticketmaster's terms forbid caching event content beyond what is needed to
-- provide the service, and require removal within 24 hours on request. So this
-- table is strictly a scratch buffer for the current send: rows carry an
-- expires_at and the drainer purges them. It must never become an archive.
--
-- Keyed per (city, event) because events are fetched per city and one can be
-- relevant to more than one subscribed city.
create table public.events_cache (
  city_id           bigint not null references public.cities (id) on delete cascade,
  tm_event_id       text not null,
  name              text not null,
  url               text,
  local_date        date,
  local_time        time,
  venue_name        text,
  venue_city        text,
  venue_state       text,
  image_url         text,
  tm_genre_id       text,
  tm_subgenre_id    text,
  -- [{ tm_attraction_id, name, url, image_url, tm_genre_id, is_headliner }]
  attractions       jsonb not null default '[]'::jsonb,
  fetched_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  primary key (city_id, tm_event_id)
);

create index events_cache_expiry_idx on public.events_cache (expires_at);
create index events_cache_lookup_idx on public.events_cache (city_id, local_date);

-- Caches hold no user data and are only ever read through the service role.
-- RLS on with no policy = deny all for anon/authenticated.
alter table public.artists      enable row level security;
alter table public.events_cache enable row level security;

-- ---------------------------------------------------------------------------
-- Digest pipeline
-- ---------------------------------------------------------------------------

create type public.run_status as enum ('building', 'queued', 'done', 'failed');
create type public.job_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');

create table public.digest_runs (
  id          uuid primary key default gen_random_uuid(),
  run_date    date not null,
  status      public.run_status not null default 'building',
  -- Inclusive/exclusive bounds of the week this digest covers.
  window_start date not null,
  window_end   date not null,
  stats       jsonb not null default '{}'::jsonb,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_date)
);

create table public.digest_jobs (
  id            bigint generated always as identity primary key,
  run_id        uuid not null references public.digest_runs (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  status        public.job_status not null default 'queued',
  -- The drainer will not touch a job before this instant. Computed from the
  -- user's own timezone and digest_send_hour when the job is enqueued.
  send_after    timestamptz not null,
  attempts      smallint not null default 0,
  event_count   integer,
  email_id      text,
  error         text,
  -- Lease so two overlapping drainer invocations cannot send the same email
  -- twice. A row is claimable when locked_until is null or in the past.
  locked_until  timestamptz,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  unique (run_id, user_id)
);

create index digest_jobs_claim_idx
  on public.digest_jobs (status, send_after)
  where status = 'queued';

alter table public.digest_runs enable row level security;
alter table public.digest_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- Quota counters
-- ---------------------------------------------------------------------------

-- Per-user daily counters. Currently guards feed uploads, which is what stops
-- one user from running up the project's OpenAI bill.
create table public.usage_counters (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  kind     text not null,
  count    integer not null default 0,
  primary key (user_id, day, kind)
);

alter table public.usage_counters enable row level security;

create policy "own usage is readable" on public.usage_counters
  for select using (auth.uid() = user_id);

-- Account-wide daily counters. Needed for YouTube's search.list ceiling, which
-- is a hard 100 calls/day for the whole project rather than per user.
create table public.global_counters (
  day    date not null,
  kind   text not null,
  count  integer not null default 0,
  primary key (day, kind)
);

alter table public.global_counters enable row level security;

-- Atomic increment-and-return so a quota check cannot race. Returns the count
-- *after* incrementing.
create function public.bump_usage(
  p_user_id uuid,
  p_kind    text,
  p_day     date,
  p_amount  integer default 1
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_count integer;
begin
  -- Aliased so the DO UPDATE clause can reference the target row unambiguously
  -- (`count` is also a function name, and search_path is empty here).
  insert into public.usage_counters as uc (user_id, day, kind, count)
  values (p_user_id, p_day, p_kind, p_amount)
  on conflict (user_id, day, kind)
    do update set count = uc.count + p_amount
  returning uc.count into new_count;
  return new_count;
end;
$$;

create function public.bump_global_usage(
  p_kind    text,
  p_day     date,
  p_amount  integer default 1
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_count integer;
begin
  insert into public.global_counters as gc (day, kind, count)
  values (p_day, p_kind, p_amount)
  on conflict (day, kind)
    do update set count = gc.count + p_amount
  returning gc.count into new_count;
  return new_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger genre_prefs_touch
  before update on public.genre_prefs
  for each row execute function public.touch_updated_at();
