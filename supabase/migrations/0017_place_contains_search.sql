-- Make a place findable by a word that is not its first.
--
-- `search_key` is "name, st" and the only query shape against it is a prefix
-- LIKE, so the reader has to start at the beginning of the name and punctuate it
-- the way the Census does. Measured against the live table:
--
--   "francisco"   -> 0 rows   (San Francisco is there; the prefix is "san")
--   "boston ma"   -> 0 rows   (the stored form has a comma: "boston, ma")
--
-- The obvious fix — a text[] of the words, GIN indexed — does not work here. GIN
-- on an array matches elements *exactly*, and this box queries on every
-- keystroke: "franc" would find nothing until "francisco" was complete. Trigrams
-- are the index that answers an unanchored LIKE, so that is what this adds.
--
-- `search_flat` drops the comma so a reader who types "boston ma" is matched the
-- same as one who types "boston, ma". GENERATED means Postgres fills it for all
-- 32,329 existing rows and keeps it current — no re-seed, and nothing for
-- scripts/seed-places.ts to remember.
--
-- The prefix index stays and stays primary. /api/places/search runs this as a
-- second, lower tier so that typing "cam" still offers Cambridge before
-- Birmingham, which contains "ham" but is not what anyone typing it meant.
--
-- (The "St. Louis" vs "Saint Louis" case is deliberately still unsolved. It
-- needs an abbreviation map, not an index.)

-- Into `extensions`, not `public`. Supabase exposes `public` over PostgREST, so
-- anything that lands there becomes a callable RPC — which is the whole subject
-- of migration 0004. pg_trgm's functions are not SECURITY DEFINER and only
-- touch the text handed to them, so this is tidiness rather than a hole, but the
-- stance is worth keeping consistent.
create extension if not exists pg_trgm with schema extensions;

alter table public.places
  add column search_flat text
  generated always as (replace(search_key, ',', '')) stored;

-- `gin_trgm_ops` resolves from wherever pg_trgm actually ended up: `extensions`
-- on Supabase, `public` on a plain Postgres where that schema does not exist.
-- Naming both here means this migration applies either way.
set local search_path = public, extensions;

-- gin_trgm_ops is what makes `like '%franc%'` indexable at all; the default
-- operator class cannot serve an unanchored pattern.
create index places_search_flat_trgm_idx
  on public.places using gin (search_flat gin_trgm_ops);

comment on column public.places.search_flat is
  'search_key with the comma removed, for unanchored trigram search. Generated; never written by the seeder.';
