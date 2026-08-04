-- Subscribing without creating an account first.
--
-- The landing page lets someone type an email and get the weekly digest for their
-- detected region without registering. That has to be double opt-in: writing an
-- unverified address straight into the send list is exactly the unsolicited-mail
-- vector that migration 0005 closed from the other direction. So a submission
-- lands here, one confirmation email goes out, and only clicking it creates a real
-- subscriber.
--
-- Why there is no second send path, and therefore no way to send twice:
-- confirming creates (or reuses) an ordinary Supabase auth user, and the digest
-- pipeline reads subscribers exclusively from `profiles`. auth.users enforces one
-- row per email address, so someone who later signs up properly with the same
-- address lands on the same account and the same single profiles row. This table
-- is only ever a waiting room — nothing in it is ever emailed a digest.

create table public.pending_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  -- Stored lowercased by the application so a resubmission replaces rather than
  -- duplicating. Unique for the same reason.
  email           text not null unique,
  city_id         bigint references public.cities (id) on delete cascade,
  genre_ids       bigint[] not null default '{}',
  timezone        text not null default 'America/New_York',
  -- How many confirmation emails this address has been sent. Capped by the
  -- application so the endpoint cannot be used to repeatedly mail a stranger.
  confirm_count   smallint not null default 0,
  confirm_sent_at timestamptz,
  created_at      timestamptz not null default now(),
  -- Unconfirmed rows are not kept indefinitely; the confirmation token carries the
  -- same lifetime.
  expires_at      timestamptz not null default (now() + interval '7 days')
);

create index pending_subscriptions_expiry_idx
  on public.pending_subscriptions (expires_at);

-- RLS on with no policies: unreachable from anon or authenticated. Everything
-- here happens through the service role, because by definition the person has no
-- session yet.
alter table public.pending_subscriptions enable row level security;

-- Looking up whether an address already has an account. auth.users enforces
-- uniqueness, so this is a lookup index rather than a constraint — adding a unique
-- index here could fail on historical data and would duplicate a guarantee that
-- already exists upstream.
create index profiles_email_lower_idx on public.profiles (lower(email));

-- Sweeps expired waiting-room rows. Called from the drainer alongside the event
-- cache purge, so it needs no schedule of its own.
create function public.purge_expired_pending_subscriptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  with deleted as (
    delete from public.pending_subscriptions
    where expires_at < now()
    returning 1
  )
  select count(*) into removed from deleted;

  return removed;
end;
$$;

-- Same lockdown as every other definer function — see 0004 for why the default
-- PUBLIC EXECUTE grant is a real problem rather than a theoretical one.
revoke all on function public.purge_expired_pending_subscriptions()
  from public, anon, authenticated;
grant execute on function public.purge_expired_pending_subscriptions()
  to service_role;
