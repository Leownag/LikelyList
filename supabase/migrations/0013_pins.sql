-- ---------------------------------------------------------------------------
-- Pinned events
-- ---------------------------------------------------------------------------
--
-- A pin has to be self-contained, and that is the whole design decision here.
--
-- The obvious shape — a row pointing at events_cache — cannot work. That table is a
-- scratch buffer for one send: 36-hour TTL, purged on every drain pass, and it is
-- short-lived deliberately because Ticketmaster's terms forbid archiving their
-- listings. A pin referencing it would go blank within two days, which is the exact
-- opposite of what pinning is for.
--
-- So a pin copies what it needs to render. That is not denormalisation for speed, it is
-- the difference between the feature working and not. It also keeps the copy narrow: a
-- name, a place, a time, and the link back to Ticketmaster — the things a reader needs
-- to decide whether to go, and nothing that would amount to keeping a copy of their
-- catalogue.
--
-- `tm_event_id` is kept so an event can be recognised across sessions (so a card can
-- show as already pinned), not as a foreign key to anything.

create table public.pinned_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  tm_event_id   text not null,

  name          text not null,
  url           text,
  -- Venue-local, exactly as Ticketmaster gives it. Never converted on the way in:
  -- the local reading is what is printed on the ticket.
  local_date    date,
  local_time    time,
  -- The venue's IANA zone. Without it "add to calendar" cannot resolve an instant,
  -- and an 8pm Boston show lands in a Los Angeles calendar three hours wrong.
  timezone      text,
  venue_name    text,
  city_label    text,
  image_url     text,
  genre_name    text,
  -- Just names and their billing role, enough to render the card. No YouTube or
  -- Spotify links: those are derived from the name at render time and would only rot
  -- if stored.
  performers    jsonb not null default '[]'::jsonb,

  pinned_at     timestamptz not null default now(),

  -- One pin per event per reader. Pinning twice is idempotent rather than an error.
  unique (user_id, tm_event_id)
);

create index pinned_events_user_idx
  on public.pinned_events (user_id, local_date);

-- Owned rows, so RLS does the enforcing rather than application code remembering to.
alter table public.pinned_events enable row level security;

create policy "own pins are readable" on public.pinned_events
  for select using (auth.uid() = user_id);

create policy "own pins are insertable" on public.pinned_events
  for insert with check (auth.uid() = user_id);

create policy "own pins are deletable" on public.pinned_events
  for delete using (auth.uid() = user_id);

-- No update policy on purpose. A pin is a snapshot: the only sensible edits are
-- creating and removing one, and leaving UPDATE closed means a reader cannot rewrite
-- the date on a show and then be surprised by it.
