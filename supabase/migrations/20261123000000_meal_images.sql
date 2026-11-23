-- Shared cache of meal photos resolved through the `fetch-meal-image` Edge Function.
-- Public read so every client can reuse a resolved photo without calling Getty again;
-- only the service role (the Edge Function) writes.

create table if not exists public.meal_images (
  query_key text primary key,
  meal_name text not null,
  status text not null check (status in ('ok', 'no_match')),
  provider text not null default 'getty',
  asset_id text,
  image_url text,
  thumb_url text,
  width integer,
  height integer,
  title text,
  artist text,
  collection_name text,
  credit_line text,
  referral_url text,
  license_model text,
  attribution_required boolean not null default true,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_images_ok_has_url check (status <> 'ok' or image_url is not null)
);

drop trigger if exists set_updated_at on public.meal_images;
create trigger set_updated_at before update on public.meal_images
  for each row execute function public.set_updated_at();

alter table public.meal_images enable row level security;

drop policy if exists meal_images_public_read on public.meal_images;
create policy meal_images_public_read on public.meal_images
  for select to anon, authenticated
  using (true);

revoke all on public.meal_images from anon, authenticated;
grant select on public.meal_images to anon, authenticated;
