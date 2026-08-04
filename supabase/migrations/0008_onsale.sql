-- ---------------------------------------------------------------------------
-- On-sale dates for the "on sale this week" section
-- ---------------------------------------------------------------------------
--
-- The digest's original premise was the next seven days of shows. For anything in
-- demand that is already too late: tickets went on sale weeks earlier, so a
-- Friday email about next Thursday's show is a description of something the reader
-- can no longer get into. The thing they actually missed was the onsale.
--
-- Ticketmaster returns this as `sales.public.startDateTime`, and it is filterable
-- with the documented `onsaleStartDateTime` / `onsaleEndDateTime` event-search
-- parameters — which is why this can be one extra query per city rather than a
-- scan of every future event.
--
-- Stored as timestamptz, not a date: unlike `local_date`, which is a venue wall
-- clock, an onsale is a single instant that everybody races at the same time, and
-- the email renders it in each subscriber's own timezone.

alter table public.events_cache
  add column onsale_start timestamptz;

-- The onsale query selects on (city, onsale_start) and never on local_date, so it
-- needs its own index; events_cache_lookup_idx cannot serve it.
create index events_cache_onsale_idx
  on public.events_cache (city_id, onsale_start);
