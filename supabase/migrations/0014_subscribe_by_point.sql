-- ---------------------------------------------------------------------------
-- Subscriptions become points, not cities
-- ---------------------------------------------------------------------------
--
-- A subscription referenced a row in `cities`, a curated list of 43 metros, which meant
-- the set of places anybody could follow was a quota decision rather than a product
-- one. Coordinates remove that: Ticketmaster is queried by point and radius — the only
-- combination it honours — so a place needs no `tm_city` and does not have to be one we
-- picked in advance.
--
-- The city becomes a label. `city_id` stays, nullable, for rows that did come from the
-- curated picker; nothing reads it to build a query any more.
--
-- The cost this has to answer for: the planner made one API call per distinct subscribed
-- city. One per distinct *point* would mean two people in neighbouring suburbs paying
-- twice for overlapping results, against a 5000/day ceiling the weekly send depends on.
-- So points are rounded onto a quarter-degree grid and the planner queries once per
-- occupied cell. The rounded point is the query centre and the cache key at once, so
-- there is no separate representative point to choose.
--
-- `geo_cell` is computed here in SQL rather than by application code, so existing rows
-- can be backfilled by this migration. It must stay identical to geoCellKey in
-- src/lib/geo-cell.ts — the grid is a quarter degree, rounded to nearest, trailing
-- zeros trimmed. There are tests on the TypeScript side; this is the mirror.

alter table public.subscriptions
  add column latitude   double precision,
  add column longitude  double precision,
  -- Display only. "Amherst" / "MA".
  add column place_name text,
  add column state_code text,
  add column geo_cell   text;

-- Backfill from the curated cities, which seed-cities now populates with coordinates.
update public.subscriptions s
set latitude   = c.latitude,
    longitude  = c.longitude,
    place_name = c.name,
    state_code = c.state_code
from public.cities c
where s.city_id = c.id
  and s.latitude is null;

-- The grid, in SQL. `trim_scale` drops trailing zeros so 42.250 and 42.25 cannot become
-- two keys; `+ 0` normalises -0.00 to 0 so the equator and prime meridian do not produce
-- a "-0" that would key a second row to the same cell.
update public.subscriptions
set geo_cell =
      trim_scale(round((latitude  * 4)::numeric) / 4 + 0)::text || ',' ||
      trim_scale(round((longitude * 4)::numeric) / 4 + 0)::text
where latitude is not null
  and longitude is not null
  and geo_cell is null;

-- A subscription with no point is unusable — the planner cannot search from it — so a
-- row that survived the backfill without one is deleted rather than left to fail
-- silently every Friday. In practice this is only a city row that was never seeded with
-- coordinates.
delete from public.subscriptions where latitude is null or longitude is null;

alter table public.subscriptions
  alter column latitude  set not null,
  alter column longitude set not null,
  alter column geo_cell  set not null,
  -- Now nullable: a subscription to a Census place has no curated city.
  alter column city_id   drop not null;

-- The old uniqueness was (user_id, city_id). Following the same point twice is the thing
-- to prevent now, and two different places inside one cell are still two subscriptions —
-- the cell is a query-batching detail, not an identity.
alter table public.subscriptions
  drop constraint subscriptions_user_id_city_id_key;

create unique index subscriptions_user_point_key
  on public.subscriptions (user_id, latitude, longitude);

create index subscriptions_cell_idx on public.subscriptions (geo_cell);

-- ---------------------------------------------------------------------------
-- events_cache is keyed by cell instead of city
-- ---------------------------------------------------------------------------
--
-- Truncated rather than migrated. This table is a 36-hour scratch buffer that the Friday
-- planner refills — it is short-lived on purpose, because Ticketmaster's terms forbid
-- archiving listings — so there is nothing here worth carrying across, and old rows have
-- no cell to derive.

truncate table public.events_cache;

alter table public.events_cache
  drop constraint events_cache_pkey,
  add column geo_cell text;

-- Every row written from now on has one; the column is nullable only for the instant
-- between these two statements.
alter table public.events_cache
  alter column geo_cell set not null,
  alter column city_id  drop not null;

alter table public.events_cache
  add primary key (geo_cell, tm_event_id);

drop index if exists events_cache_lookup_idx;
create index events_cache_lookup_idx
  on public.events_cache (geo_cell, local_date);

-- The on-sale query selects on cell and onsale instant, never on local_date.
drop index if exists events_cache_onsale_idx;
create index events_cache_onsale_idx
  on public.events_cache (geo_cell, onsale_start);
