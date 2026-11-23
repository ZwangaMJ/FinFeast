-- User meals and groceries (full CRUD, owner-only RLS) plus a shared food photo cache.
--
-- Starter meals stay in the app's catalogue (src/data/recipes.ts) for every user. `meals` only
-- holds what a user changes: new meals, edited copies of a starter (`base_recipe_id`), and
-- hidden starters (`hidden = true`). New and existing users therefore need no seed rows.

create table if not exists public.meals (
  user_id uuid not null references public.user_profiles (user_id) on delete cascade,
  id text not null,
  base_recipe_id text,
  hidden boolean not null default false,
  name text not null check (char_length(name) between 1 and 80),
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  fallback_emoji text not null default '🍽️',
  calories integer not null default 0 check (calories between 0 and 5000),
  protein integer not null default 0 check (protein between 0 and 500),
  minutes integer not null default 0 check (minutes between 0 and 600),
  cost_per_serving numeric(12, 2) check (cost_per_serving >= 0),
  cost_currency text not null default 'ZAR' check (cost_currency in ('ZAR', 'USD', 'GBP', 'EUR')),
  diet text not null default 'vegetarian' check (diet in ('vegan', 'vegetarian', 'fish', 'poultry', 'red')),
  allergens text[] not null default '{}',
  ingredients jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredients) = 'array'),
  notes text not null default '',
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  image_url text,
  image_attribution jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  -- A new meal must carry its own cost; an edited starter may inherit the starter's pricing.
  constraint meals_custom_needs_cost check (base_recipe_id is not null or cost_per_serving is not null)
);

create unique index if not exists meals_user_base_recipe_idx on public.meals (user_id, base_recipe_id) where base_recipe_id is not null;

create table if not exists public.groceries (
  user_id uuid not null references public.user_profiles (user_id) on delete cascade,
  id text not null,
  -- The recipe this item is for: a starter id or `u_<meals.id>`. Not a foreign key because
  -- starter recipes live in the app catalogue, not in this database.
  meal_id text,
  name text not null check (char_length(name) between 1 and 80),
  quantity numeric(12, 3) check (quantity > 0),
  unit text,
  estimated_cost numeric(12, 2) check (estimated_cost >= 0),
  cost_currency text not null default 'ZAR' check (cost_currency in ('ZAR', 'USD', 'GBP', 'EUR')),
  checked boolean not null default false,
  fallback_emoji text not null default '🛒',
  image_url text,
  image_attribution jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists groceries_user_meal_idx on public.groceries (user_id, meal_id);

-- Shared photo cache: one row per normalized query and provider. Public read; only the
-- `fetch-food-image` Edge Function (service role) writes.
create table if not exists public.food_image_cache (
  query_key text not null,
  provider text not null,
  query text not null,
  status text not null check (status in ('ok', 'no_match')),
  photo_id text,
  image_url text,
  thumb_url text,
  width integer,
  height integer,
  alt text,
  photographer_name text,
  photographer_url text,
  source_url text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (query_key, provider),
  constraint food_image_cache_ok_has_url check (status <> 'ok' or image_url is not null)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['meals', 'groceries', 'food_image_cache']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name);
    execute format('alter table public.%I enable row level security', table_name);
  end loop;

  foreach table_name in array array['meals', 'groceries']
  loop
    execute format('drop policy if exists select_own on public.%I', table_name);
    execute format('drop policy if exists insert_own on public.%I', table_name);
    execute format('drop policy if exists update_own on public.%I', table_name);
    execute format('drop policy if exists delete_own on public.%I', table_name);
    execute format('create policy select_own on public.%I for select to authenticated using (user_id = (select auth.uid()))', table_name);
    execute format('create policy insert_own on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', table_name);
    execute format('create policy update_own on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', table_name);
    execute format('create policy delete_own on public.%I for delete to authenticated using (user_id = (select auth.uid()))', table_name);
  end loop;
end;
$$;

drop policy if exists food_image_cache_public_read on public.food_image_cache;
create policy food_image_cache_public_read on public.food_image_cache for select to anon, authenticated using (true);

grant select, insert, update, delete on public.meals, public.groceries to authenticated;
revoke all on public.food_image_cache from anon, authenticated;
grant select on public.food_image_cache to anon, authenticated;

-- Saves the user's full meal and grocery lists in one transaction (upsert + delete missing),
-- matching how `replace_user_data` saves the rest of the app state.
create or replace function public.replace_user_food(p_meals jsonb, p_groceries jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to save FinFeast data';
  end if;
  if p_meals is null or jsonb_typeof(p_meals) <> 'array' or p_groceries is null or jsonb_typeof(p_groceries) <> 'array' then
    raise exception 'Meals and groceries must be JSON arrays';
  end if;

  delete from public.meals existing
  where existing.user_id = current_user_id
    and not exists (select 1 from jsonb_to_recordset(p_meals) as item(id text) where item.id = existing.id);

  insert into public.meals (
    user_id, id, base_recipe_id, hidden, name, slot, fallback_emoji, calories, protein, minutes,
    cost_per_serving, cost_currency, diet, allergens, ingredients, notes, steps, image_url, image_attribution, created_at
  )
  select
    current_user_id, item.id, item."baseRecipeId", coalesce(item.hidden, false), item.name, item.slot,
    coalesce(nullif(item.emoji, ''), '🍽️'), coalesce(item.kcal, 0), coalesce(item.protein, 0), coalesce(item.minutes, 0),
    item."costPerServing", coalesce(item."costCurrency", 'ZAR'), coalesce(item.diet, 'vegetarian'),
    array(select jsonb_array_elements_text(coalesce(item.allergens, '[]'::jsonb))),
    coalesce(item.ingredients, '[]'::jsonb), coalesce(item.notes, ''), coalesce(item.steps, '[]'::jsonb),
    item.image ->> 'url', case when item.image is null or jsonb_typeof(item.image) = 'null' then null else item.image end,
    coalesce(item."createdAt", now())
  from jsonb_to_recordset(p_meals) as item(
    id text, "baseRecipeId" text, hidden boolean, name text, slot text, emoji text, kcal integer, protein integer,
    minutes integer, "costPerServing" numeric, "costCurrency" text, diet text, allergens jsonb, ingredients jsonb,
    notes text, steps jsonb, image jsonb, "createdAt" timestamptz
  )
  on conflict (user_id, id) do update set
    base_recipe_id = excluded.base_recipe_id, hidden = excluded.hidden, name = excluded.name, slot = excluded.slot,
    fallback_emoji = excluded.fallback_emoji, calories = excluded.calories, protein = excluded.protein,
    minutes = excluded.minutes, cost_per_serving = excluded.cost_per_serving, cost_currency = excluded.cost_currency,
    diet = excluded.diet, allergens = excluded.allergens, ingredients = excluded.ingredients, notes = excluded.notes,
    steps = excluded.steps, image_url = excluded.image_url, image_attribution = excluded.image_attribution;

  delete from public.groceries existing
  where existing.user_id = current_user_id
    and not exists (select 1 from jsonb_to_recordset(p_groceries) as item(id text) where item.id = existing.id);

  insert into public.groceries (
    user_id, id, meal_id, name, quantity, unit, estimated_cost, cost_currency, checked, fallback_emoji,
    image_url, image_attribution, created_at
  )
  select
    current_user_id, item.id, item."mealId", item.name, item.quantity, nullif(item.unit, ''), item."estCost",
    coalesce(item."costCurrency", 'ZAR'), coalesce(item.checked, false), coalesce(nullif(item.emoji, ''), '🛒'),
    item.image ->> 'url', case when item.image is null or jsonb_typeof(item.image) = 'null' then null else item.image end,
    coalesce(item."createdAt", now())
  from jsonb_to_recordset(p_groceries) as item(
    id text, "mealId" text, name text, quantity numeric, unit text, "estCost" numeric, "costCurrency" text,
    checked boolean, emoji text, image jsonb, "createdAt" timestamptz
  )
  on conflict (user_id, id) do update set
    meal_id = excluded.meal_id, name = excluded.name, quantity = excluded.quantity, unit = excluded.unit,
    estimated_cost = excluded.estimated_cost, cost_currency = excluded.cost_currency, checked = excluded.checked,
    fallback_emoji = excluded.fallback_emoji, image_url = excluded.image_url, image_attribution = excluded.image_attribution;
end;
$$;

revoke all on function public.replace_user_food(jsonb, jsonb) from public, anon;
grant execute on function public.replace_user_food(jsonb, jsonb) to authenticated;
