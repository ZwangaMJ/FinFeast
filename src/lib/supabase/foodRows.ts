/**
 * Maps `meals` / `groceries` rows (snake_case, numeric strings) to app types. Pure, so the
 * mapping is unit-tested without a database. Writes go through `replace_user_food`, which
 * takes the app types as JSON directly.
 */
import type { Allergen, Currency, CustomIngredient, FoodImageRef, GroceryEntry, MealDiet, MealKind, UserMeal } from '@/store/types';

export type MealRow = {
  id: string;
  base_recipe_id: string | null;
  hidden: boolean;
  name: string;
  slot: MealKind;
  fallback_emoji: string;
  calories: number;
  protein: number;
  minutes: number;
  cost_per_serving: number | string | null;
  cost_currency: Currency;
  diet: MealDiet;
  allergens: Allergen[] | null;
  ingredients: unknown;
  notes: string | null;
  steps: unknown;
  image_url: string | null;
  image_attribution: unknown;
  created_at: string;
  updated_at: string;
};

export type GroceryRow = {
  id: string;
  meal_id: string | null;
  name: string;
  quantity: number | string | null;
  unit: string | null;
  estimated_cost: number | string | null;
  cost_currency: Currency;
  checked: boolean;
  fallback_emoji: string;
  image_url: string | null;
  image_attribution: unknown;
  created_at: string;
  updated_at: string;
};

const num = (v: number | string | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The stored image: `image_attribution` holds the full ref; `image_url` is the indexed copy. */
export function imageFromRow(url: string | null, attribution: unknown): FoodImageRef | null {
  const a = attribution && typeof attribution === 'object' ? (attribution as Record<string, unknown>) : {};
  const u = str(a.url) ?? url;
  if (!u) return null;
  return { url: u, thumbUrl: str(a.thumbUrl), photographer: str(a.photographer), photographerUrl: str(a.photographerUrl), sourceUrl: str(a.sourceUrl), provider: str(a.provider) };
}

function ingredientsFrom(v: unknown): CustomIngredient[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && typeof (i as { name?: unknown }).name === 'string')
    .map((i) => ({ name: String(i.name), qty: num((i.qty as number | string | null) ?? null), unit: str(i.unit) }));
}

const stepsFrom = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

export function mealFromRow(row: MealRow): UserMeal {
  return {
    id: row.id,
    baseRecipeId: row.base_recipe_id,
    hidden: row.hidden,
    name: row.name,
    slot: row.slot,
    emoji: row.fallback_emoji,
    kcal: row.calories,
    protein: row.protein,
    minutes: row.minutes,
    costPerServing: num(row.cost_per_serving),
    costCurrency: row.cost_currency,
    diet: row.diet,
    allergens: row.allergens ?? [],
    ingredients: ingredientsFrom(row.ingredients),
    notes: row.notes ?? '',
    steps: stepsFrom(row.steps),
    image: imageFromRow(row.image_url, row.image_attribution),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function groceryFromRow(row: GroceryRow): GroceryEntry {
  return {
    id: row.id,
    name: row.name,
    quantity: num(row.quantity),
    unit: row.unit,
    estCost: num(row.estimated_cost),
    costCurrency: row.cost_currency,
    checked: row.checked,
    mealId: row.meal_id,
    emoji: row.fallback_emoji,
    image: imageFromRow(row.image_url, row.image_attribution),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
