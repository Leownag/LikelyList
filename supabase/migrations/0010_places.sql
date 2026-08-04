-- ---------------------------------------------------------------------------
-- Every US place, so no city is un-searchable
-- ---------------------------------------------------------------------------
--
-- `cities` is a curated list of 43 metros and stays that way: it is the picker the
-- product was designed around and its rows carry a `tm_city` string. This table is
-- the other thing — the full set of US places, purely so that typing a town name
-- finds it.
--
-- Why a separate table rather than more rows in `cities`: they answer different
-- questions and have different shapes. A row here has no `tm_city`, because nothing
-- queries Ticketmaster by name any more — searching is done by coordinates and a
-- radius, which is the only combination Ticketmaster honours (see
-- EventSearchParams.geoPoint for the measurements). So a place needs a point, not a
-- name Ticketmaster recognises, which is exactly why opening up the list costs
-- nothing.
--
-- Source: the US Census Bureau Gazetteer place file, which is a work of the US
-- government and therefore public domain — no key, no attribution clause, no rate
-- limit, and it is the same data the Bureau's own tools run on. It carries no
-- population figures, which is why `rank` below exists.

create table public.places (
  -- The Census GEOID. Stable across yearly files, unlike a name+state pair, so
  -- re-seeding updates rows instead of duplicating them.
  geoid       text primary key,
  name        text not null,
  state_code  text not null,
  latitude    double precision not null,
  longitude   double precision not null,
  /**
   * Ordering hint for the typeahead, low number first.
   *
   * Needed because the Gazetteer has no population column and the Census
   * population API now requires a key. So this is derived from what the file does
   * carry: whether the place is one of the curated metros, then whether it is an
   * incorporated city/town rather than a Census-designated place, then land area.
   * It is a proxy and is named as one — "Portland, OR before Portland, TX" comes
   * out right, but this is not a population ranking and should not be read as one.
   */
  rank        integer not null default 1000,
  -- Lowercased "name, st", so a prefix search can hit one index.
  search_key  text not null
);

-- Prefix search is the only query shape: `search_key like 'nash%'`. text_pattern_ops
-- is what lets that use an index at all — the default collation-aware index cannot
-- serve a LIKE prefix.
create index places_search_idx on public.places (search_key text_pattern_ops);
create index places_rank_idx on public.places (rank);

-- Read through the service role only, like the other reference caches. The typeahead
-- goes through an API route rather than PostgREST so the query shape stays fixed.
alter table public.places enable row level security;
