-- Lock down the SECURITY DEFINER functions.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and Supabase
-- gives the `anon` and `authenticated` roles USAGE on schema public — so every
-- function added in the earlier migrations was callable over PostgREST RPC by
-- any signed-in user, with the definer's privileges. Concretely, before this
-- migration a logged-in user could:
--
--   * rpc/claim_digest_jobs  -> lease every pending job, then let the lease lapse
--                               and burn `attempts` until they hit the limit,
--                               permanently suppressing every subscriber's email
--   * rpc/release_stale_digest_jobs with p_max_attempts = 0
--                            -> mark all in-flight jobs failed immediately
--   * rpc/bump_usage         -> exhaust ANOTHER user's daily feed-upload quota,
--                               since the function takes p_user_id as an argument
--   * rpc/bump_global_usage  -> exhaust the project-wide YouTube search budget
--                               for everybody
--
-- None of these are meant to be reachable from a browser: they are called only by
-- the digest pipeline through the service role, which is exempt from these
-- revocations.
--
-- bump_usage keeps taking p_user_id rather than reading auth.uid(): the only
-- legitimate caller is server-side code acting on a user's behalf, and there is
-- no session in the cron path for auth.uid() to return.

revoke all on function public.claim_digest_jobs(integer, integer)
  from public, anon, authenticated;
revoke all on function public.release_stale_digest_jobs(integer)
  from public, anon, authenticated;
revoke all on function public.purge_expired_events()
  from public, anon, authenticated;
revoke all on function public.finalize_digest_run(uuid)
  from public, anon, authenticated;
revoke all on function public.bump_usage(uuid, text, date, integer)
  from public, anon, authenticated;
revoke all on function public.bump_global_usage(text, date, integer)
  from public, anon, authenticated;

-- Trigger functions. Triggers fire as the table owner regardless of who holds
-- EXECUTE, so revoking here costs nothing and removes them from the RPC surface.
revoke all on function public.handle_new_user()
  from public, anon, authenticated;
revoke all on function public.touch_updated_at()
  from public, anon, authenticated;

grant execute on function public.claim_digest_jobs(integer, integer) to service_role;
grant execute on function public.release_stale_digest_jobs(integer) to service_role;
grant execute on function public.purge_expired_events() to service_role;
grant execute on function public.finalize_digest_run(uuid) to service_role;
grant execute on function public.bump_global_usage(text, date, integer) to service_role;

-- bump_usage is the one exception: it is called from the feed upload route using
-- the user's own request-scoped client, so `authenticated` needs it back.
--
-- Granting it back reopens the quota-tampering path on its own, because the
-- function takes p_user_id as an argument. So it is recreated below with a guard:
-- a caller that has a session may only bump its own counter. The service role has
-- no session, so auth.uid() is null there and the cron path is unaffected.
create or replace function public.bump_usage(
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
  caller    uuid := auth.uid();
begin
  if caller is not null and caller <> p_user_id then
    raise exception 'bump_usage: cannot modify another user''s quota';
  end if;

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

grant execute on function public.bump_usage(uuid, text, date, integer)
  to service_role, authenticated;

-- Stop the same thing happening to functions added later.
alter default privileges in schema public revoke execute on functions from public;
