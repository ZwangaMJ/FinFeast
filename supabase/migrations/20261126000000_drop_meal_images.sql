-- The first photo pipeline (`fetch-meal-image` + `meal_images`) is replaced by
-- `fetch-food-image` + `food_image_cache` (20261125000000). The `meal-images` Storage
-- bucket stays: the new function stores its copies under `food/`.
drop table if exists public.meal_images;
