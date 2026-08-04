-- ---------------------------------------------------------------------------
-- ZIP code → coordinates, cached permanently
-- ---------------------------------------------------------------------------
--
-- Searching by `postalCode` barely works. Measured on one Boston week with
-- npm run tm:probe:
--
--   postalCode=02134                    2 events
--   postalCode=02134 + radius=25mi      2 events   <- radius silently ignored
--   postalCode=02134 + radius=50mi      2 events   <- likewise
--   city=Boston                        21 events
--   geoPoint + radius=25mi             64 events
--   geoPoint + radius=50mi             85 events
--
-- Ticketmaster matches a postal code exactly and accepts `radius` without acting
-- on it, so a ZIP search saw only the venues inside that one ZIP — two of them.
-- `radius` only takes effect alongside coordinates, which means a ZIP has to be
-- turned into a latitude and longitude before it is any use.
--
-- Hence this table. Geocoding is one HTTP call to a third party, and a ZIP
-- centroid does not move, so each code is looked up once ever and read from here
-- afterwards — the same bargain as the permanent YouTube lookups on `artists`.
-- It holds no user data: a row records that somebody, once, searched a ZIP.

create table public.postal_codes (
  code        text primary key,
  latitude    double precision not null,
  longitude   double precision not null,
  -- Human-readable, so the UI can echo back "Allston, MA" and the reader can tell
  -- immediately that a typo'd ZIP is not where they meant.
  place_name  text,
  state_code  text,
  fetched_at  timestamptz not null default now()
);

-- Reached only through the service role, like the other caches. RLS on with no
-- policy = deny all for anon/authenticated.
alter table public.postal_codes enable row level security;
