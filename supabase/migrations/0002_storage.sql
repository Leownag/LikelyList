-- Storage bucket for feed screenshots.
--
-- These images are transient by design: they exist only long enough for the
-- vision model to read them, then the server deletes them and keeps the
-- structured extraction. The bucket is private — nothing in the app or the
-- email ever links to a user's screenshot.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feeds',
  'feeds',
  false,
  10485760, -- 10 MB; the client downscales before upload, so this is a backstop
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Objects are namespaced by user id: feeds/<user_id>/<feed_id>.<ext>
-- so the first path segment is the ownership check.

create policy "feed images are readable by their owner"
  on storage.objects for select
  using (
    bucket_id = 'feeds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "feed images are writable by their owner"
  on storage.objects for insert
  with check (
    bucket_id = 'feeds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "feed images are deletable by their owner"
  on storage.objects for delete
  using (
    bucket_id = 'feeds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
