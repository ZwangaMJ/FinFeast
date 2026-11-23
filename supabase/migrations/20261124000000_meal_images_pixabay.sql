-- Switch meal photos from Getty Images to Pixabay.
-- Pixabay forbids permanent hotlinking, so the Edge Function copies each chosen photo into
-- this public Storage bucket and `meal_images` only stores URLs of our copies.

alter table public.meal_images alter column provider set default 'pixabay';

-- No Getty photo was ever stored (the key was never enabled); clear any placeholder rows.
delete from public.meal_images where provider = 'getty';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-images', 'meal-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets serve objects via /storage/v1/object/public/ without a select policy.
-- No insert/update/delete policies: only the service role (the Edge Function) writes.
