-- Rename two columns that described the wrong feature.
--
-- Feeds were built assuming the input was a concert flyer. The actual intent is a
-- screenshot of a music app — a Spotify home screen, a liked-songs list, a
-- top-artists page — so that likelylist can learn who someone listens to. Flyers
-- still work, they are just no longer the assumed case.
--
-- The old names actively misled: `not_an_event` was true for exactly the input the
-- feature is *for*, and `role` held a flyer's billing position, which means nothing
-- on a playlist screen.
--
-- No data migration is needed for the jsonb payload: `feeds.extracted` is read
-- through a zod schema, and any row written before this point simply lacks the new
-- keys. The confirmation UI treats a missing key the same as a null.

alter table public.feeds
  rename column not_an_event to not_music_related;

comment on column public.feeds.not_music_related is
  'True when the image had nothing to do with music at all. Recorded rather than discarded so the UI can explain why nothing was learned.';

alter table public.feed_artists
  rename column role to prominence;

comment on column public.feed_artists.prominence is
  '''primary'' when the screenshot presents the act as an artist in its own right (artist tile, followed-artists row, flyer headline); ''mentioned'' when it only appears as the performer of a listed track. Weighted differently when applied.';
