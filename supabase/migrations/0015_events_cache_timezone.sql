-- ---------------------------------------------------------------------------
-- The venue's timezone, in the shared event cache
-- ---------------------------------------------------------------------------
--
-- `local_date` and `local_time` are a wall clock with no zone, which is all the email
-- ever needed: it renders a label. Pinning changed that. A pin becomes a calendar
-- entry, and a calendar entry needs an instant — so without a zone here, a show
-- pinned from My feed could only ever be stored as a date, and "add to calendar"
-- turned an 8pm gig into an all-day entry while the same show pinned from /explore
-- got the time right. Same button, two answers.
--
-- Nullable, because Ticketmaster does not always supply one and an all-day entry is
-- the honest fallback when nobody knows the zone. See lineup.eventTimezone for where
-- the value comes from: `dates.timezone` when present, the venue's own zone when not.
alter table public.events_cache
  add column timezone text;
