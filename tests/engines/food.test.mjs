import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { RECIPE_BY_ID, RECIPES } from '../../src/data/recipes.ts';
import { activeRecipes, buildCatalog, customRecipeId, getIngredient, getRecipe, hasRecipe, recipeDiet, setUserMeals, virtualIngredientKey } from '../../src/lib/catalog.ts';
import { fixedEnv } from '../../src/lib/env.ts';
import { buildGroceryList, hardFilter, planCost, servingCost, solvePlan } from '../../src/lib/mealPlanner.ts';
import { groceryFromRow, imageFromRow, mealFromRow } from '../../src/lib/supabase/foodRows.ts';
import * as food from '../../src/store/food.ts';
import { deepFreeze, plannerInput } from './fixtures.mjs';

const env = fixedEnv('2026-11-23', { idPrefix: 'm1-' });
const env2 = fixedEnv('2026-11-24', { idPrefix: 'm2-' });

const curry = (over = {}) => ({
  name: '  Mom’s   lentil curry ',
  slot: 'dinner',
  emoji: '🍛',
  kcal: 620,
  protein: 28,
  minutes: 40,
  costPerServing: 30,
  costCurrency: 'ZAR',
  diet: 'vegan',
  allergens: [],
  ingredients: [{ name: 'Red lentils', qty: 1, unit: 'cup' }, { name: ' ', qty: null, unit: null }],
  notes: ' Freezes well ',
  steps: ['Fry onions', ' ', 'Simmer lentils'],
  ...over,
});

afterEach(() => setUserMeals([]));

describe('meal CRUD (pure transitions)', () => {
  it('creates a custom meal with cleaned fields and a u_ recipe id', () => {
    const before = deepFreeze([]);
    const { meals, meal, recipeId } = food.createMeal(before, curry(), env);
    assert.equal(meals.length, 1);
    assert.equal(recipeId, customRecipeId(meal.id));
    assert.equal(meal.name, 'Mom’s lentil curry');
    assert.deepEqual(meal.ingredients, [{ name: 'Red lentils', qty: 1, unit: 'cup' }]);
    assert.deepEqual(meal.steps, ['Fry onions', 'Simmer lentils']);
    assert.equal(meal.notes, 'Freezes well');
    assert.equal(meal.baseRecipeId, null);
    assert.equal(meal.createdAt, env.now);
  });

  it('updates a custom meal in place and clears its photo only when renamed', () => {
    const { meals, recipeId } = food.createMeal([], curry(), env);
    const withImage = food.setMealImage(meals, meals[0].id, { url: 'https://x/1.jpg' }, env);
    const sameName = food.editRecipe(withImage, recipeId, curry({ kcal: 700 }), env2);
    assert.equal(sameName.meal.kcal, 700);
    assert.equal(sameName.meal.image.url, 'https://x/1.jpg');
    assert.equal(sameName.meal.updatedAt, env2.now);
    const renamed = food.editRecipe(withImage, recipeId, curry({ name: 'Dal' }), env2);
    assert.equal(renamed.meals.length, 1);
    assert.equal(renamed.meal.image, null);
  });

  it('editing a built-in saves the user’s copy; editing again updates that copy', () => {
    const base = RECIPE_BY_ID.b_oats;
    const input = food.mealInputFromRecipe(base, null, 'ZAR');
    const first = food.editRecipe([], 'b_oats', { ...input, name: 'My oats' }, env);
    assert.equal(first.meal.baseRecipeId, 'b_oats');
    const second = food.editRecipe(first.meals, 'b_oats', { ...input, name: 'Better oats' }, env2);
    assert.equal(second.meals.length, 1);
    assert.equal(second.meal.name, 'Better oats');
    assert.equal(food.editRecipe([], 'nope', input, env), null);
  });

  it('deleting a custom meal removes it; deleting a built-in hides it; restore brings it back', () => {
    const { meals, recipeId } = food.createMeal([], curry(), env);
    assert.deepEqual(food.deleteRecipe(meals, recipeId, env, 'ZAR'), []);
    const hidden = food.deleteRecipe([], 'd_chilli' in RECIPE_BY_ID ? 'd_chilli' : RECIPES.find((r) => r.slot === 'dinner').id, env, 'ZAR');
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].hidden, true);
    assert.deepEqual(food.restoreBuiltIn(hidden, hidden[0].baseRecipeId), []);
  });

  it('validates meal input', () => {
    assert.deepEqual(food.validateMealInput(curry()), {});
    const errors = food.validateMealInput(curry({ name: ' ', kcal: -1, costPerServing: null }));
    assert.ok(errors.name && errors.kcal && errors.costPerServing);
    // An edited built-in may keep pack pricing (null cost).
    assert.equal(food.validateMealInput(curry({ costPerServing: null }), { builtIn: true }).costPerServing, undefined);
    assert.ok(food.validateMealInput(curry({ name: 'x'.repeat(81) })).name);
    assert.ok(food.validateMealInput(curry({ protein: NaN })).protein);
  });
});

describe('grocery CRUD (pure transitions)', () => {
  const milk = { name: ' Milk ', quantity: 2, unit: ' L ', estCost: 38, costCurrency: 'ZAR', mealId: null, emoji: '' };

  it('creates, updates, toggles and deletes', () => {
    const { groceries, item } = food.createGroceryItem(deepFreeze([]), milk, env);
    assert.equal(item.name, 'Milk');
    assert.equal(item.unit, 'L');
    assert.equal(item.emoji, food.DEFAULT_GROCERY_EMOJI);
    assert.equal(item.checked, false);
    const toggled = food.toggleGroceryItem(groceries, item.id, env2);
    assert.equal(toggled[0].checked, true);
    const updated = food.updateGroceryItem(toggled, item.id, { quantity: 3 }, env2);
    assert.equal(updated[0].quantity, 3);
    assert.equal(updated[0].checked, true);
    assert.deepEqual(food.deleteGroceryItem(updated, item.id), []);
  });

  it('drops only the items linked to a deleted meal', () => {
    let list = food.createGroceryItem([], { ...milk, mealId: 'u_a' }, env).groceries;
    list = food.createGroceryItem(list, { ...milk, name: 'Bread' }, env2).groceries;
    assert.deepEqual(food.dropMealGroceries(list, 'u_a').map((g) => g.name), ['Bread']);
  });

  it('validates grocery input', () => {
    assert.deepEqual(food.validateGroceryInput(milk), {});
    const errors = food.validateGroceryInput({ ...milk, name: '', quantity: 0, estCost: -1 });
    assert.ok(errors.name && errors.quantity && errors.estCost);
  });
});

describe('catalogue', () => {
  it('without user meals it is exactly the starter catalogue', () => {
    const c = buildCatalog([]);
    assert.equal(c.recipes.length, RECIPES.length);
    assert.equal(c.byId.b_oats, RECIPE_BY_ID.b_oats);
  });

  it('adds custom meals, replaces edited built-ins in place, and hides removed ones from the pool', () => {
    const custom = food.createMeal([], curry(), env);
    const edited = food.editRecipe(custom.meals, 'b_oats', { ...food.mealInputFromRecipe(RECIPE_BY_ID.b_oats, null, 'ZAR'), name: 'My oats' }, env2).meals;
    const dinner = RECIPES.find((r) => r.slot === 'dinner').id;
    const all = food.deleteRecipe(edited, dinner, env2, 'ZAR');
    const c = buildCatalog(all);
    assert.equal(c.recipes.length, RECIPES.length); // +1 custom, −1 hidden
    assert.equal(c.byId.b_oats.name, 'My oats');
    assert.equal(c.byId.b_oats.source, 'edited');
    assert.deepEqual(c.byId.b_oats.ingredients, RECIPE_BY_ID.b_oats.ingredients); // still pack-priced
    assert.ok(!c.recipes.some((r) => r.id === dinner));
    assert.ok(c.byId[dinner], 'hidden built-ins still resolve for existing plans');
    assert.equal(c.byId[custom.recipeId].source, 'custom');
  });

  it('prices a user meal through one virtual per-serving ingredient in any currency', () => {
    const { meals, recipeId } = food.createMeal([], curry({ costPerServing: 3, costCurrency: 'USD' }), env);
    setUserMeals(meals);
    const key = virtualIngredientKey(recipeId);
    assert.deepEqual(getRecipe(recipeId).ingredients, [{ key, use: 1 }]);
    assert.equal(getIngredient(key).aisle, 'Other');
    assert.ok(Math.abs(servingCost(recipeId, [], 'USD') - 3) < 1e-9);
    assert.ok(Math.abs(servingCost(recipeId, [], 'ZAR') - 40) < 1e-9);
  });

  it('a missing recipe resolves to a placeholder instead of crashing', () => {
    assert.equal(hasRecipe('u_gone'), false);
    assert.equal(getRecipe('u_gone').name, 'Removed meal');
    assert.equal(servingCost('u_gone', [], 'ZAR'), 0);
  });

  it('maps diets both ways', () => {
    for (const d of ['vegan', 'vegetarian', 'fish', 'poultry', 'red']) {
      const { meals, recipeId } = food.createMeal([], curry({ diet: d }), env);
      assert.equal(recipeDiet(buildCatalog(meals).byId[recipeId]), d);
    }
  });
});

describe('planner with user meals', () => {
  it('only plans meals from the user’s catalogue and costs custom meals on the grocery list', () => {
    // Hide every starter dinner and add one custom dinner: every dinner must be the custom meal.
    let meals = [];
    for (const r of RECIPES.filter((x) => x.slot === 'dinner')) meals = food.deleteRecipe(meals, r.id, env, 'ZAR');
    const created = food.createMeal(meals, curry(), env2);
    setUserMeals(created.meals);
    assert.deepEqual(activeRecipes().filter((r) => r.slot === 'dinner').map((r) => r.id), [created.recipeId]);

    const input = plannerInput({ ceiling: 5000 });
    const result = solvePlan(input);
    const plan = result.ok ? result.value.plan : result.error.fallback;
    assert.ok(plan.days.every((d) => d.slots.dinner.recipeId === created.recipeId));

    const list = buildGroceryList(plan.days, input.profile.householdSize, [], 'ZAR');
    const line = list.find((i) => i.key === virtualIngredientKey(created.recipeId));
    const servings = 7 * input.profile.householdSize;
    assert.equal(line.aisle, 'Other');
    assert.equal(line.qty, `${servings} servings`);
    assert.ok(Math.abs(line.estPrice - servings * 30) < 1e-6);
    assert.ok(planCost(plan.days, input.profile.householdSize, [], 'ZAR') >= line.estPrice);
  });

  it('respects diet filters for custom meals', () => {
    const { meals, recipeId } = food.createMeal([], curry({ diet: 'red', slot: 'lunch' }), env);
    setUserMeals(meals);
    const vegan = hardFilter({ ...plannerInput().profile, diet: 'vegan', allergies: [] });
    assert.ok(vegan.ok);
    assert.ok(!vegan.value.pools.lunch.some((r) => r.id === recipeId));
  });
});

describe('Supabase row mapping', () => {
  it('maps meal rows, including numeric strings and attribution JSON', () => {
    const meal = mealFromRow({
      id: 'm1', base_recipe_id: null, hidden: false, name: 'Curry', slot: 'dinner', fallback_emoji: '🍛', calories: 600, protein: 25, minutes: 40,
      cost_per_serving: '30.50', cost_currency: 'ZAR', diet: 'vegan', allergens: null, ingredients: [{ name: 'Lentils', qty: '1', unit: 'cup' }, { bad: true }],
      notes: null, steps: ['a', 3], image_url: 'https://x/1.jpg', image_attribution: { url: 'https://x/1.jpg', photographer: 'Ella', provider: 'pexels' },
      created_at: '2026-11-23T00:00:00Z', updated_at: '2026-11-23T00:00:00Z',
    });
    assert.equal(meal.costPerServing, 30.5);
    assert.deepEqual(meal.allergens, []);
    assert.deepEqual(meal.ingredients, [{ name: 'Lentils', qty: 1, unit: 'cup' }]);
    assert.deepEqual(meal.steps, ['a']);
    assert.equal(meal.notes, '');
    assert.equal(meal.image.photographer, 'Ella');
  });

  it('maps grocery rows and missing images', () => {
    const g = groceryFromRow({ id: 'g1', meal_id: null, name: 'Milk', quantity: '2.000', unit: 'L', estimated_cost: null, cost_currency: 'ZAR', checked: true, fallback_emoji: '🥛', image_url: null, image_attribution: null, created_at: 'c', updated_at: 'u' });
    assert.equal(g.quantity, 2);
    assert.equal(g.estCost, null);
    assert.equal(g.image, null);
    assert.equal(imageFromRow(null, { url: 'https://x' }).url, 'https://x');
  });
});
