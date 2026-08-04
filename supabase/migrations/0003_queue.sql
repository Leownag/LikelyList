-- Queue claiming for the digest drainer.
--
-- The drainer runs every five minutes and a Worker invocation can be killed
-- mid-flight, so two things have to be true: two overlapping drainers must never
-- send the same email twice, and a job whose drainer died must come back on its
-- own rather than sitting in 'sending' forever.
--
-- Both need a single atomic statement, which is why this is a database function
-- rather than a select-then-update from the application. PostgREST cannot express
-- `attempts = attempts + 1` or `FOR UPDATE SKIP LOCKED`.

create function public.claim_digest_jobs(
  p_limit         integer,
  p_lease_seconds integer default 300
)
returns setof public.digest_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.digest_jobs j
  set status       = 'sending',
      attempts     = j.attempts + 1,
      locked_until = now() + make_interval(secs => p_lease_seconds)
  where j.id in (
    select inner_job.id
    from public.digest_jobs inner_job
    where inner_job.status = 'queued'
      and inner_job.send_after <= now()
      and (inner_job.locked_until is null or inner_job.locked_until < now())
    order by inner_job.send_after
    limit p_limit
    -- SKIP LOCKED is what makes concurrent drainers safe: each takes a disjoint
    -- set of rows instead of blocking on the same ones.
    for update skip locked
  )
  returning j.*;
end;
$$;

-- Returns jobs whose lease expired mid-send to the queue, up to the attempt
-- limit. Without this, a Worker killed between claiming and sending would leave
-- a subscriber permanently un-emailed.
create function public.release_stale_digest_jobs(
  p_max_attempts integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released integer;
begin
  with reclaimed as (
    update public.digest_jobs
    set status = case
                   when attempts >= p_max_attempts then 'failed'::public.job_status
                   else 'queued'::public.job_status
                 end,
        locked_until = null,
        error = case
                  when attempts >= p_max_attempts
                    then coalesce(error, 'Gave up after ' || attempts || ' attempts.')
                  else error
                end
    where status = 'sending'
      and locked_until is not null
      and locked_until < now()
    returning 1
  )
  select count(*) into released from reclaimed;

  return released;
end;
$$;

-- Drops event rows past their TTL.
--
-- Ticketmaster's terms allow caching event content only for as long as providing
-- the service requires, and require removal within 24 hours on request. This
-- table is a scratch buffer for one send, not an archive, so it is swept on every
-- drainer pass.
create function public.purge_expired_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  with deleted as (
    delete from public.events_cache
    where expires_at < now()
    returning 1
  )
  select count(*) into removed from deleted;

  return removed;
end;
$$;

-- Marks a run finished once none of its jobs are still waiting.
create function public.finalize_digest_run(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  outstanding integer;
begin
  select count(*) into outstanding
  from public.digest_jobs
  where run_id = p_run_id
    and status in ('queued', 'sending');

  if outstanding > 0 then
    return false;
  end if;

  update public.digest_runs
  set status = 'done',
      finished_at = coalesce(finished_at, now())
  where id = p_run_id
    and status <> 'done';

  return true;
end;
$$;
