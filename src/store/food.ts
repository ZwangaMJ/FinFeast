/**
 * Pure state transitions for the user's meals and groceries (no React, no Supabase).
 * The store wraps these; tests call them directly with a fixed `Env`.
 */
import { RECIPE_BY_ID, type Recipe } from '@/data/recipes';
import { customRecipeId, isCustomRecipeId, recipeDiet } from '@/lib/catalog';
import { idFor, type Env } from '@/lib/env';
import type { Allergen, Currency, CustomIngredient, FoodImageRef, GroceryEntry, MealDiet, MealKind, UserMeal } from './types';

export const MAX_NAME = 80;

/** What a meal form edits. */
export type MealInput = {
  name: string;
  slot: MealKind;
  emoji: string;
  kcal: number;
  protein: number;
  minutes: number;
  /** null keeps a built-in's ingredient pricing (only valid when editing a built-in). */
  costPerServing: number | null;
  costCurrency: Currency;
  diet: MealDiet;
  allergens: Allergen[];
  ingredients: CustomIngredient[];
  notes: string;
  steps: string[];
};

export type GroceryInput = {
  name: string;
  quantity: number | null;
  unit: string | null;
  estCost: number | null;
  costCurrency: Currency;
  mealId: string | null;
  emoji: string;
};

export const DEFAULT_MEAL_EMOJI: Record<MealKind, string> = { breakfast: '🥣', lunch: '🥪', dinner: '🍲', snack: '🍎' };
export const DEFAULT_GROCERY_EMOJI = '🛒';

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const finiteOr = (n: number | null | undefined, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export function validateMealInput(input: MealInput, opts: { builtIn?: boolean } = {}): FieldErrors<MealInput> {
  const errors: FieldErrors<MealInput> = {};
  const name = clean(input.name);
  if (!name) errors.name = 'Give the meal a name.';
  else if (name.length > MAX_NAME) errors.name = `Keep the name under ${MAX_NAME} characters.`;
  if (!(input.kcal >= 0 && input.kcal <= 5000)) errors.kcal = 'Calories must be between 0 and 5000.';
  if (!(input.protein >= 0 && input.protein <= 500)) errors.protein = 'Protein must be between 0 and 500 g.';
  if (!(input.minutes >= 0 && input.minutes <= 600)) errors.minutes = 'Cook time must be between 0 and 600 minutes.';
  if (input.costPerServing === null) {
    if (!opts.builtIn) errors.costPerServing = 'Add an estimated cost per serving.';
  } else if (!(input.costPerServing >= 0 && input.costPerServing <= 100000)) {
    errors.costPerServing = 'Cost must be zero or more.';
  }
  return errors;
}

export function validateGroceryInput(input: GroceryInput): FieldErrors<GroceryInput> {
  const errors: FieldErrors<GroceryInput> = {};
  const name = clean(input.name);
  if (!name) errors.name = 'Give the item a name.';
  else if (name.length > MAX_NAME) errors.name = `Keep the name under ${MAX_NAME} characters.`;
  if (input.quantity !== null && !(input.quantity > 0)) errors.quantity = 'Quantity must be more than zero.';
  if (input.estCost !== null && !(input.estCost >= 0)) errors.estCost = 'Cost must be zero or more.';
  return errors;
}

const normalizeMealInput = (input: MealInput): MealInput => ({
  ...input,
  name: clean(input.name).slice(0, MAX_NAME),
  emoji: input.emoji.trim() || DEFAULT_MEAL_EMOJI[input.slot],
  kcal: Math.round(finiteOr(input.kcal, 0)),
  protein: Math.round(finiteOr(input.protein, 0)),
  minutes: Math.round(finiteOr(input.minutes, 0)),
  costPerServing: input.costPerServing === null ? null : Math.max(0, finiteOr(input.costPerServing, 0)),
  allergens: [...new Set(input.allergens)],
  ingredients: input.ingredients.map((i) => ({ name: clean(i.name), qty: i.qty ?? null, unit: i.unit?.trim() || null })).filter((i) => i.name),
  notes: input.notes.trim(),
  steps: input.steps.map(clean).filter(Boolean),
});

/** A form prefilled from any recipe (built-in, edited or custom). */
export function mealInputFromRecipe(r: Recipe, costPerServing: number | null, currency: Currency): MealInput {
  return {
    name: r.name,
    slot: r.slot,
    emoji: r.emoji,
    kcal: r.kcal,
    protein: r.protein,
    minutes: r.minutes,
    costPerServing,
    costCurrency: currency,
    diet: recipeDiet(r),
    allergens: [...r.allergens],
    ingredients: r.customIngredients?.map((i) => ({ ...i })) ?? [],
    notes: r.notes ?? '',
    steps: [...r.steps],
  };
}

export function blankMealInput(slot: MealKind, currency: Currency): MealInput {
  return { name: '', slot, emoji: DEFAULT_MEAL_EMOJI[slot], kcal: 500, protein: 20, minutes: 30, costPerServing: 0, costCurrency: currency, diet: 'vegetarian', allergens: [], ingredients: [], notes: '', steps: [] };
}

/** The user-meal row behind a recipe id, if any. */
export function mealForRecipe(meals: readonly UserMeal[], recipeId: string): UserMeal | undefined {
  return isCustomRecipeId(recipeId) ? meals.find((m) => customRecipeId(m.id) === recipeId) : meals.find((m) => m.baseRecipeId === recipeId);
}

/** Creates a new custom meal. Returns the new list and the recipe id to use in plans. */
export function createMeal(meals: readonly UserMeal[], input: MealInput, env: Env): { meals: UserMeal[]; meal: UserMeal; recipeId: string } {
  const n = normalizeMealInput(input);
  const meal: UserMeal = { ...n, id: idFor(env, 0), baseRecipeId: null, hidden: false, image: null, createdAt: env.now, updatedAt: env.now };
  return { meals: [...meals, meal], meal, recipeId: customRecipeId(meal.id) };
}

/**
 * Edits any recipe: a custom meal is updated in place; a built-in gets (or updates) the
 * user's edited copy. A name change clears the stored photo so it is looked up again.
 */
export function editRecipe(meals: readonly UserMeal[], recipeId: string, input: MealInput, env: Env): { meals: UserMeal[]; meal: UserMeal } | null {
  const n = normalizeMealInput(input);
  const existing = mealForRecipe(meals, recipeId);
  if (existing) {
    const meal: UserMeal = { ...existing, ...n, image: existing.name === n.name ? existing.image : null, updatedAt: env.now };
    return { meals: meals.map((m) => (m.id === existing.id ? meal : m)), meal };
  }
  if (!RECIPE_BY_ID[recipeId]) return null;
  const meal: UserMeal = { ...n, id: idFor(env, 0), baseRecipeId: recipeId, hidden: false, image: null, createdAt: env.now, updatedAt: env.now };
  return { meals: [...meals, meal], meal };
}

/** Deletes a custom meal, or hides a built-in from this user's planner. */
export function deleteRecipe(meals: readonly UserMeal[], recipeId: string, env: Env, currency: Currency): UserMeal[] {
  if (isCustomRecipeId(recipeId)) return meals.filter((m) => customRecipeId(m.id) !== recipeId);
  const base = RECIPE_BY_ID[recipeId];
  if (!base) return [...meals];
  const existing = meals.find((m) => m.baseRecipeId === recipeId);
  if (existing) return meals.map((m) => (m.id === existing.id ? { ...m, hidden: true, updatedAt: env.now } : m));
  const hidden: UserMeal = { ...mealInputFromRecipe(base, null, currency), id: idFor(env, 0), baseRecipeId: recipeId, hidden: true, image: null, createdAt: env.now, updatedAt: env.now };
  return [...meals, hidden];
}

/** Undoes edits/hiding of a built-in recipe. */
export function restoreBuiltIn(meals: readonly UserMeal[], recipeId: string): UserMeal[] {
  return meals.filter((m) => m.baseRecipeId !== recipeId);
}

export function setMealImage(meals: readonly UserMeal[], mealId: string, image: FoodImageRef | null, env: Env): UserMeal[] {
  return meals.map((m) => (m.id === mealId ? { ...m, image, updatedAt: env.now } : m));
}

// ---------------------------------------------------------------------------
// Groceries

const normalizeGroceryInput = (input: GroceryInput): GroceryInput => ({
  ...input,
  name: clean(input.name).slice(0, MAX_NAME),
  unit: input.unit?.trim() || null,
  quantity: input.quantity === null ? null : finiteOr(input.quantity, 1),
  estCost: input.estCost === null ? null : Math.max(0, finiteOr(input.estCost, 0)),
  emoji: input.emoji.trim() || DEFAULT_GROCERY_EMOJI,
});

export function createGroceryItem(items: readonly GroceryEntry[], input: GroceryInput, env: Env): { groceries: GroceryEntry[]; item: GroceryEntry } {
  const item: GroceryEntry = { ...normalizeGroceryInput(input), id: idFor(env, 0), checked: false, image: null, createdAt: env.now, updatedAt: env.now };
  return { groceries: [...items, item], item };
}

export function updateGroceryItem(items: readonly GroceryEntry[], id: string, patch: Partial<GroceryInput>, env: Env): GroceryEntry[] {
  return items.map((i) => {
    if (i.id !== id) return i;
    const next = normalizeGroceryInput({ ...i, ...patch });
    return { ...i, ...next, image: next.name === i.name ? i.image : null, updatedAt: env.now };
  });
}

export const deleteGroceryItem = (items: readonly GroceryEntry[], id: string): GroceryEntry[] => items.filter((i) => i.id !== id);

export const toggleGroceryItem = (items: readonly GroceryEntry[], id: string, env: Env): GroceryEntry[] =>
  items.map((i) => (i.id === id ? { ...i, checked: !i.checked, updatedAt: env.now } : i));

export const setGroceryImage = (items: readonly GroceryEntry[], id: string, image: FoodImageRef | null, env: Env): GroceryEntry[] =>
  items.map((i) => (i.id === id ? { ...i, image, updatedAt: env.now } : i));

/** Groceries tied to a meal are dropped with it, standalone items are kept. */
export const dropMealGroceries = (items: readonly GroceryEntry[], recipeId: string): GroceryEntry[] => items.filter((i) => i.mealId !== recipeId);
