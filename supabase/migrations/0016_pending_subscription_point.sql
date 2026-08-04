-- A waiting-room row remembers a point, not only a curated city.
--
-- /explore searches anywhere: it offers all 32,329 Census places and it accepts a ZIP.
-- But "Email me this every Friday" could only carry a `cities` row, so the subscribe
-- box had to ask a second time with a dropdown of the 43 curated metros — and someone
-- who had just searched Amherst was silently offered Boston. Since 0014 a subscription
-- is a point, so the only thing missing was somewhere to keep that point across the
-- confirmation round trip.
--
-- Nullable, and city_id stays: a curated city still records its id, which is what keeps
-- it visible in the city grid on /app/subscriptions. A row with coordinates and no
-- city_id becomes the same kind of subscription followPlace creates.
--
-- Resolved server-side before it is written here — from `places` for a GEOID, from
-- `postal_codes` for a ZIP — so these columns never hold coordinates a browser chose.

alter table public.pending_subscriptions
  add column place_name text,
  add column state_code text,
  add column latitude   double precision,
  add column longitude  double precision;
