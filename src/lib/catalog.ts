/**
 * The meal catalogue the planner and screens work from: the built-in starter recipes in
 * src/data/recipes.ts merged with the user's own meals (`AppData.meals`).
 *
 * - A **custom** meal becomes recipe `u_<meal id>`.
 * - An **edited** built-in replaces that recipe id in place, so existing plans keep working.
 * - A **hidden** built-in leaves the planner's pool but still resolves by id, so a plan that
 *   already contains it keeps rendering until that slot is replaced.
 * - A meal priced by the user (`costPerServing` set) is costed through one virtual ingredient,
 *   `meal:<recipe id>`, whose "pack" is one serving. Serving cost, plan cost, the budget solver
 *   and the grocery list then work unchanged.
 *
 * The conversion functions are pure. The registry at the bottom is a small module-level cache
 * of the current user's catalogue (set by the store), so id lookups scattered across screens
 * don't each need the user's meals threaded through.
 */
import { INGREDIENTS, RECIPES, RECIPE_BY_ID, type Ingredient, type Recipe } from '@/data/recipes';
import { PRICE_FACTOR } from '@/lib/format';
import type { MealDiet, UserMeal } from '@/store/types';

export type Catalog = Readonly<{
  /** Recipes the planner may choose from (hidden built-ins excluded). */
  recipes: readonly Recipe[];
  /** Every resolvable recipe, including hidden built-ins. */
  byId: Readonly<Record<string, Recipe>>;
  /** Virtual per-serving ingredients of user-priced meals. */
  ingredients: Readonly<Record<string, Ingredient>>;
}>;

export const CUSTOM_PREFIX = 'u_';
export const VIRTUAL_PREFIX = 'meal:';

export const customRecipeId = (mealId: string) => `${CUSTOM_PREFIX}${mealId}`;
export const virtualIngredientKey = (recipeId: string) => `${VIRTUAL_PREFIX}${recipeId}`;
export const isCustomRecipeId = (id: string) => id.startsWith(CUSTOM_PREFIX);
export const isBuiltInRecipeId = (id: string) => id in RECIPE_BY_ID;

const TINTS: Record<UserMeal['slot'], Recipe['tint']> = { breakfast: 'amber', lunch: 'green', dinner: 'red', snack: 'blue' };

export function dietFields(diet: MealDiet): Pick<Recipe, 'meat' | 'vegan' | 'dairy'> {
  switch (diet) {
    case 'vegan':
      return { meat: 'none', vegan: true, dairy: false };
    case 'vegetarian':
      return { meat: 'none', vegan: false, dairy: true };
    default:
      return { meat: diet, vegan: false, dairy: false };
  }
}

export function recipeDiet(r: Pick<Recipe, 'meat' | 'vegan'>): MealDiet {
  if (r.vegan) return 'vegan';
  return r.meat === 'none' ? 'vegetarian' : r.meat;
}

/** Converts a user's per-serving cost into the catalogue's base currency (ZAR). */
export const toBasePrice = (cost: number, currency: UserMeal['costCurrency']) => cost / PRICE_FACTOR[currency];

/** The recipe a user meal stands for. `base` is the built-in it edits, if any. */
export function userMealToRecipe(meal: UserMeal, base?: Recipe): Recipe {
  const id = meal.baseRecipeId && base ? base.id : customRecipeId(meal.id);
  const userPriced = meal.costPerServing !== null || !base;
  const ingredients = userPriced ? [{ key: virtualIngredientKey(id), use: 1 }] : base.ingredients;
  return {
    id,
    name: meal.name,
    emoji: meal.emoji,
    tint: base?.tint ?? TINTS[meal.slot],
    slot: meal.slot,
    kcal: meal.kcal,
    protein: meal.protein,
    minutes: meal.minutes,
    ...dietFields(meal.diet),
    allergens: [...meal.allergens],
    mainProtein: base?.mainProtein ?? meal.name.toLowerCase(),
    batch: base?.batch,
    classic: base?.classic,
    ingredients,
    steps: meal.steps.length ? [...meal.steps] : base ? [...base.steps] : [],
    source: base ? 'edited' : 'custom',
    userMealId: meal.id,
    customIngredients: userPriced ? meal.ingredients.map((i) => ({ ...i })) : undefined,
    notes: meal.notes || undefined,
    image: meal.image,
  };
}

/** The virtual ingredient that carries a user-priced meal's cost (one "pack" = one serving). */
export function virtualIngredient(recipe: Recipe, meal: UserMeal): Ingredient {
  return {
    name: `Ingredients for ${recipe.name}`,
    pack: 'serving',
    price: toBasePrice(meal.costPerServing ?? 0, meal.costCurrency),
    aisle: 'Other',
  };
}

export function buildCatalog(meals: readonly UserMeal[]): Catalog {
  const byId: Record<string, Recipe> = { ...RECIPE_BY_ID };
  const ingredients: Record<string, Ingredient> = {};
  const hidden = new Set<string>();
  const custom: Recipe[] = [];

  for (const meal of meals) {
    const base = meal.baseRecipeId ? RECIPE_BY_ID[meal.baseRecipeId] : undefined;
    if (meal.baseRecipeId && !base) continue; // edits a built-in that no longer exists
    if (base && meal.hidden) hidden.add(base.id);
    const recipe = userMealToRecipe(meal, base);
    byId[recipe.id] = recipe;
    if (recipe.ingredients[0]?.key === virtualIngredientKey(recipe.id)) ingredients[virtualIngredientKey(recipe.id)] = virtualIngredient(recipe, meal);
    if (!base) custom.push(recipe);
  }

  const recipes = [...RECIPES.filter((r) => !hidden.has(r.id)).map((r) => byId[r.id]), ...custom];
  return { recipes, byId, ingredients };
}

/** A stand-in so a plan that still references a deleted meal renders instead of crashing. */
export function missingRecipe(id: string): Recipe {
  return {
    id,
    name: 'Removed meal',
    emoji: '🍽️',
    tint: 'blue',
    slot: 'dinner',
    kcal: 0,
    protein: 0,
    minutes: 0,
    meat: 'none',
    vegan: true,
    dairy: false,
    allergens: [],
    mainProtein: id,
    ingredients: [],
    steps: [],
    source: 'custom',
  };
}

const MISSING_INGREDIENT: Ingredient = { name: 'Unknown item', pack: 'item', price: 0, aisle: 'Other' };

// ---------------------------------------------------------------------------
// Registry: the signed-in user's catalogue (empty user meals = built-ins only).

let active: Catalog = buildCatalog([]);
let activeMeals: readonly UserMeal[] = [];

/** Called by the store whenever `meals` changes. No-op when the array is unchanged. */
export function setUserMeals(meals: readonly UserMeal[]) {
  if (meals === activeMeals) return;
  activeMeals = meals;
  active = buildCatalog(meals);
}

export const activeCatalog = (): Catalog => active;
export const activeRecipes = (): readonly Recipe[] => active.recipes;
export const getRecipe = (id: string): Recipe => active.byId[id] ?? missingRecipe(id);
export const hasRecipe = (id: string): boolean => id in active.byId;
export const getIngredient = (key: string): Ingredient => INGREDIENTS[key] ?? active.ingredients[key] ?? MISSING_INGREDIENT;
