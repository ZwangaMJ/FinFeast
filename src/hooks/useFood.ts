/**
 * Data access for the user's meals and groceries.
 *
 * Changes apply to the local store immediately (optimistic): the screen updates at once, the
 * data is cached on the device, and `src/lib/supabase/sync.ts` saves it to Supabase in the
 * background (`replace_user_food`), retrying when the connection comes back. After a create or
 * rename, a photo is looked up and stored on the row. Until it arrives, or if there is none,
 * the emoji shows.
 */
import { useMemo } from 'react';

import { foodImageResolver } from '@/hooks/useFoodImage';
import { buildCatalog } from '@/lib/catalog';
import { mealForRecipe, validateGroceryInput, validateMealInput, type FieldErrors, type GroceryInput, type MealInput } from '@/store/food';
import type { GroceryEntry, UserMeal } from '@/store/types';
import { useStore } from '@/store/useStore';

export type Saved<T> = { ok: true; id: string } | { ok: false; errors: FieldErrors<T> };

/** Looks up a photo for a meal row (if it has none) and stores it, unless the name changed meanwhile. */
function refreshMealImage(mealId: string) {
  const meal = useStore.getState().meals.find((m) => m.id === mealId);
  if (!meal || meal.image) return;
  void foodImageResolver.resolve(meal.name, 'meal').then((image) => {
    const current = useStore.getState().meals.find((m) => m.id === mealId);
    if (image && current && current.name === meal.name && !current.image) useStore.getState().setMealImage(mealId, image);
  });
}

function refreshGroceryImage(id: string) {
  const item = useStore.getState().groceries.find((g) => g.id === id);
  if (!item || item.image) return;
  void foodImageResolver.resolve(item.name, 'grocery').then((image) => {
    const current = useStore.getState().groceries.find((g) => g.id === id);
    if (image && current && current.name === item.name && !current.image) useStore.getState().setGroceryImage(id, image);
  });
}

/** The user's meal catalogue: built-ins (minus hidden) + edited + custom meals. */
export function useMeals() {
  const meals = useStore((s) => s.meals);
  const catalog = useMemo(() => buildCatalog(meals), [meals]);
  const hidden = useMemo(() => meals.filter((m) => m.hidden && m.baseRecipeId), [meals]);
  return { meals, recipes: catalog.recipes, byId: catalog.byId, hidden };
}

export function useGroceries(): GroceryEntry[] {
  return useStore((s) => s.groceries);
}

export const mealRowFor = (recipeId: string): UserMeal | undefined => mealForRecipe(useStore.getState().meals, recipeId);

export const foodActions = {
  /** listMeals */
  listMeals: () => buildCatalog(useStore.getState().meals).recipes,
  listGroceries: () => useStore.getState().groceries,

  createMeal(input: MealInput): Saved<MealInput> {
    const errors = validateMealInput(input);
    if (Object.keys(errors).length) return { ok: false, errors };
    const recipeId = useStore.getState().createMeal(input);
    const row = mealRowFor(recipeId);
    if (row) refreshMealImage(row.id);
    return { ok: true, id: recipeId };
  },

  /** Updates a custom meal, or saves the user's edited copy of a built-in. */
  updateMeal(recipeId: string, input: MealInput, opts: { builtIn?: boolean } = {}): Saved<MealInput> {
    const errors = validateMealInput(input, opts);
    if (Object.keys(errors).length) return { ok: false, errors };
    if (!useStore.getState().updateRecipe(recipeId, input)) return { ok: false, errors: { name: 'This meal no longer exists.' } };
    const row = mealRowFor(recipeId);
    if (row) refreshMealImage(row.id);
    return { ok: true, id: recipeId };
  },

  deleteMeal: (recipeId: string) => useStore.getState().deleteRecipe(recipeId),
  restoreMeal: (recipeId: string) => useStore.getState().restoreRecipe(recipeId),

  createGroceryItem(input: GroceryInput): Saved<GroceryInput> {
    const errors = validateGroceryInput(input);
    if (Object.keys(errors).length) return { ok: false, errors };
    const id = useStore.getState().createGroceryItem(input);
    refreshGroceryImage(id);
    return { ok: true, id };
  },

  updateGroceryItem(id: string, input: GroceryInput): Saved<GroceryInput> {
    const errors = validateGroceryInput(input);
    if (Object.keys(errors).length) return { ok: false, errors };
    useStore.getState().updateGroceryItem(id, input);
    refreshGroceryImage(id);
    return { ok: true, id };
  },

  deleteGroceryItem: (id: string) => useStore.getState().deleteGroceryItem(id),
  toggleGroceryItem: (id: string) => useStore.getState().toggleGroceryItem(id),
};
