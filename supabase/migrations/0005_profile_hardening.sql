-- Close two holes in the profiles table.
--
-- The RLS policies added in 0001 check which *row* a user may touch but say
-- nothing about which *columns*. Combined with Supabase's default table-wide
-- grants to `authenticated`, and the fact that the anon key is public by design,
-- any signed-in user could PATCH their own profiles row directly over PostgREST
-- and change any field in it. Two of those fields are load-bearing.

-- ---------------------------------------------------------------------------
-- 1. profiles.email decides where the digest is delivered
-- ---------------------------------------------------------------------------
--
-- lib/digest/build.ts reads it and lib/digest/send.ts sends to it, so a user who
-- can rewrite it can make this service mail an arbitrary third party every week,
-- from our own verified sending domain. That is an unsolicited-mail vector, and
-- the spam complaints land on mail.likelylist.tech's reputation.
--
-- Note the shape of the fix: a column-level REVOKE cannot subtract from a
-- table-wide grant — in PostgreSQL, granting UPDATE on a table covers every
-- column. The table-level privilege has to go first, then be re-granted only on
-- the columns the app legitimately writes.

revoke update on public.profiles from authenticated, anon;

grant update (timezone, digest_send_hour, digest_enabled)
  on public.profiles to authenticated;

-- The service role is unaffected: unsubscribe flips digest_enabled through it,
-- and it holds its own grants.

-- ---------------------------------------------------------------------------
-- 2. profiles.timezone is fed straight to Intl
-- ---------------------------------------------------------------------------
--
-- An unknown IANA zone makes Intl.DateTimeFormat throw a RangeError. The weekly
-- planner computes a send time for every subscriber in one pass, so a single row
-- containing a junk timezone aborted the whole run and nobody received an email.
-- The planner is now defensive too (see lib/digest/plan.ts), but the data should
-- not be able to get into that state in the first place.
--
-- Constrained to the list the settings UI actually offers (src/lib/time.ts).
-- A CHECK cannot query pg_timezone_names, so this is kept deliberately in step
-- with TIMEZONES by hand; adding a zone there means adding it here.

update public.profiles
set timezone = 'America/New_York'
where timezone not in (
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'Europe/London', 'Asia/Taipei', 'Asia/Tokyo'
);

alter table public.profiles
  add constraint profiles_timezone_supported check (
    timezone in (
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
      'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
      'Europe/London', 'Asia/Taipei', 'Asia/Tokyo'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The missing INSERT policy
-- ---------------------------------------------------------------------------
--
-- 0001 created SELECT and UPDATE policies but no INSERT policy, so RLS denied
-- inserts to authenticated users. That made requireProfile()'s backfill — the
-- path taken if the auth.users trigger has not landed yet — fail with a
-- confusing error instead of recovering. Restricted to the caller's own id.

create policy "own profile is insertable" on public.profiles
  for insert with check (auth.uid() = id);

-- Narrowed the same way as UPDATE above, and for the same reason: a column-level
-- GRANT cannot subtract from the table-wide INSERT privilege Supabase already
-- issued, so the table-level one has to be revoked first. Without this the column
-- list below would be decorative.
--
-- requireProfile() only ever inserts id and email, so that is all that is granted.
-- Combined with the UPDATE restriction this makes email write-once: set when the
-- row is created, never changeable by the owner afterwards.
revoke insert on public.profiles from authenticated, anon;
grant insert (id, email) on public.profiles to authenticated;
