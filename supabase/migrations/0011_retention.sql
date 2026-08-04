-- ---------------------------------------------------------------------------
-- Retention. Nothing here loses a feature.
-- ---------------------------------------------------------------------------
--
-- Supabase's free tier is 500 MB of database and 1 GB of file storage. The path to
-- the wall is not subscriber count — it is that five tables only ever grow, because
-- until now the only cleanup functions in the schema were purge_expired_events and
-- purge_expired_pending_subscriptions.
--
-- The worst offender is not the obvious one. `feeds` grows with uploads: a thousand
-- subscribers at four screenshots a month is roughly 48 MB a year of `extracted`
-- JSON. But `global_counters` grows with *traffic*, because the explore rate limiter
-- writes a row per visitor per hour (`explore_ip:<hash>:<hour>` — see
-- api/explore/route.ts). A few hundred visitors a day out-produces every upload.
--
-- The irony worth stating: a feed's value is fully extracted the moment `applied_at`
-- is set. Everything useful has already been written into `artist_prefs` and
-- `genre_prefs`. What remains is a receipt.
--
-- What is deliberately kept:
--   * the `feeds` row itself, so the Feeds page can still show upload history
--   * `artist_prefs` / `genre_prefs`, which are the actual product
--   * `artists`, whose YouTube columns exist so a lookup is spent once per artist
--     EVER — purging that would re-spend a hard 100/day quota
--   * `events_cache`, already handled and on a much shorter fuse (36 hours)
--
-- Storage is not touched here. Postgres cannot delete a storage object, so the
-- failed-upload images are swept by the drainer through the storage API instead.

create function public.purge_stale_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  feeds_scrubbed   integer;
  artists_removed  integer;
  jobs_removed     integer;
  runs_removed     integer;
  usage_removed    integer;
  global_removed   integer;
begin
  -- The extraction payload, 30 days after it was applied. The row survives; only
  -- the JSON goes. A feed that was never applied is left alone — it is either still
  -- pending or it failed, and the failed ones are the reader's to retry or discard.
  with scrubbed as (
    update public.feeds
    set extracted = null
    where applied_at is not null
      and applied_at < now() - interval '30 days'
      and extracted is not null
    returning 1
  )
  select count(*) into feeds_scrubbed from scrubbed;

  -- feed_artists is a per-upload copy of names that already live in artist_prefs,
  -- which is the source of truth. Nothing in src/ reads this table.
  with removed as (
    delete from public.feed_artists fa
    using public.feeds f
    where fa.feed_id = f.id
      and f.applied_at is not null
      and f.applied_at < now() - interval '30 days'
    returning 1
  )
  select count(*) into artists_removed from removed;

  -- Send history. Ninety days is long enough to answer "did this subscriber get the
  -- email in March", which is the only question these rows are ever asked.
  with removed as (
    delete from public.digest_jobs
    where created_at < now() - interval '90 days'
    returning 1
  )
  select count(*) into jobs_removed from removed;

  -- Runs after jobs, since jobs reference them. A run whose jobs are gone is a row
  -- with nothing hanging off it.
  with removed as (
    delete from public.digest_runs
    where started_at < now() - interval '90 days'
    returning 1
  )
  select count(*) into runs_removed from removed;

  -- Quota counters are only ever read for today. Sixty days is generous, and keeps
  -- enough history to notice a pattern.
  with removed as (
    delete from public.usage_counters
    where day < (current_date - 60)
    returning 1
  )
  select count(*) into usage_removed from removed;

  -- The fastest-growing table in the schema, for the reason in the header.
  with removed as (
    delete from public.global_counters
    where day < (current_date - 60)
    returning 1
  )
  select count(*) into global_removed from removed;

  return jsonb_build_object(
    'feeds_scrubbed', feeds_scrubbed,
    'feed_artists_removed', artists_removed,
    'digest_jobs_removed', jobs_removed,
    'digest_runs_removed', runs_removed,
    'usage_counters_removed', usage_removed,
    'global_counters_removed', global_removed
  );
end;
$$;

-- Same lockdown as migration 0004, and for the same reason: Postgres grants EXECUTE
-- to PUBLIC on a new function, and `anon`/`authenticated` have USAGE on this schema.
-- Left open, any signed-in user could call this over PostgREST and delete ninety
-- days of send history.
revoke all on function public.purge_stale_data() from public, anon, authenticated;
grant execute on function public.purge_stale_data() to service_role;
