import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGroceryList,
  hardFilter,
  lockKey,
  planCost,
  planOrFallback,
  PROTEIN_FLOOR_G,
  regenerateSlot,
  relinkBatches,
  solvePlan,
  withAllSwaps,
} from '../../src/lib/mealPlanner.ts';
import { deepFreeze, plannerInput } from './fixtures.mjs';

const unwrap = (r) => {
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r.ok ? '' : r.error.kind)}`);
  return r.value;
};

test('same input and seed → identical plan; frozen input is never mutated', () => {
  const input = deepFreeze(plannerInput());
  const a = solvePlan(input);
  const b = solvePlan(input);
  assert.deepEqual(a, b);
  unwrap(a);
});

test('a different seed explores a different week', () => {
  const a = unwrap(solvePlan(deepFreeze(plannerInput({ seed: 1 }))));
  const b = unwrap(solvePlan(deepFreeze(plannerInput({ seed: 2 }))));
  assert.notDeepEqual(
    a.plan.days.map((d) => d.slots.dinner.recipeId),
    b.plan.days.map((d) => d.slots.dinner.recipeId),
  );
});

test('a workable budget: plan fits the ceiling, stamps the given time, reports nutrition', () => {
  const s = unwrap(solvePlan(deepFreeze(plannerInput({ ceiling: 1400 }))));
  assert.equal(s.plan.status, 'ok');
  assert.equal(s.plan.shortfall, 0);
  assert.equal(s.plan.generatedAt, '2026-11-09T08:00:00.000Z');
  assert.equal(s.plan.days.length, 7);
  assert.ok(s.cost <= 1400);
  assert.equal(s.cost, planCost(s.plan.days, 2, [], 'ZAR'));
  assert.equal(s.nutrition.perDay.length, 7);
  assert.equal(s.nutrition.floorMet, s.nutrition.perDay.every((d) => d.protein >= PROTEIN_FLOOR_G));
});

test('hard filters: vegan + nut allergy never plans animal products or nuts', () => {
  const s = unwrap(solvePlan(deepFreeze(plannerInput({ profile: { diet: 'vegan', allergies: ['nuts'] }, ceiling: 1500 }))));
  const ids = s.plan.days.flatMap((d) => [d.slots.breakfast.recipeId, d.slots.lunch.recipeId, d.slots.dinner.recipeId, ...d.snacks]);
  assert.ok(ids.every((id) => !['b_oats', 'b_pb_toast', 's_pb_banana', 'd_hake', 'd_chicken_stew', 'l_tuna_wrap', 's_yoghurt'].includes(id)), ids.join(','));
});

test('hard filters: an impossible cook-time cap is relaxed and reported, not silently ignored', () => {
  const r = hardFilter(deepFreeze(plannerInput({ profile: { maxCookMinutes: 1 } }).profile));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.relaxedCookTime, ['breakfast', 'lunch', 'dinner']);
});

test('a budget below the nutrition floor is an honest error carrying the cheapest adequate plan', () => {
  const r = solvePlan(deepFreeze(plannerInput({ ceiling: 150 })));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'budget_floor_conflict');
  assert.ok(r.error.shortfall > 0);
  assert.equal(r.error.fallback.status, 'budget_floor_conflict');
  assert.equal(r.error.fallback.shortfall, r.error.shortfall);
  assert.equal(Math.ceil(r.error.cheapestCost - 150), r.error.shortfall);
  assert.equal(planOrFallback(r), r.error.fallback);
});

test('invalid input is rejected with a reason instead of throwing', () => {
  for (const bad of [plannerInput({ profile: { householdSize: 0 } }), plannerInput({ ceiling: -1 }), plannerInput({ weekStart: 'next monday' }), plannerInput({ profile: { calorieTarget: 0 } })]) {
    const r = solvePlan(deepFreeze(bad));
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'invalid_input');
    assert.equal(typeof r.error.reason, 'string');
    assert.equal(planOrFallback(r), null);
  }
});

test('regenerating one meal changes that slot and keeps every other locked slot', () => {
  const input = deepFreeze(plannerInput({ ceiling: 1400 }));
  const { plan } = unwrap(solvePlan(input));
  const { profile, ceiling, pantry, tried, mode } = input;
  const day = 3;
  const next = planOrFallback(regenerateSlot(deepFreeze(plan), { profile, ceiling, pantry, tried, mode, iterations: 20 }, day, 'breakfast', { seed: 7, generatedAt: 'later' }));
  assert.ok(next);
  assert.notEqual(next.days[day].slots.breakfast.recipeId, plan.days[day].slots.breakfast.recipeId);
  plan.days.forEach((d, i) => {
    if (i !== day) assert.equal(next.days[i].slots.breakfast.recipeId, d.slots.breakfast.recipeId);
    assert.equal(next.days[i].slots.dinner.recipeId, d.slots.dinner.recipeId);
  });
});

test('locked slots are honoured verbatim', () => {
  const locked = { [lockKey(0, 'dinner')]: { recipeId: 'd_hake', swaps: [] }, [lockKey(6, 'breakfast')]: { recipeId: 'b_yoghurt', swaps: [] } };
  const { plan } = unwrap(solvePlan(deepFreeze(plannerInput({ ceiling: 1500, locked }))));
  assert.equal(plan.days[0].slots.dinner.recipeId, 'd_hake');
  assert.equal(plan.days[6].slots.breakfast.recipeId, 'b_yoghurt');
});

test('batching: leftovers stay linked to their dinner; relinkBatches returns a new week', () => {
  const { plan } = unwrap(solvePlan(deepFreeze(plannerInput({ ceiling: 1400 }))));
  plan.days.forEach((d, i) => {
    const lunch = d.slots.lunch;
    if (lunch.leftoverOf !== undefined) {
      assert.equal(lunch.leftoverOf, i - 1);
      assert.equal(plan.days[i - 1].slots.dinner.recipeId, lunch.recipeId);
      assert.match(plan.days[i - 1].slots.dinner.batchNote ?? '', /^Cook once, covers/);
    }
  });
  // Break one link on a frozen copy: relink must return a fixed copy, not mutate
  const broken = structuredClone(plan.days);
  const idx = broken.findIndex((d) => d.slots.lunch.leftoverOf !== undefined);
  if (idx > 0) {
    broken[idx - 1].slots.dinner.recipeId = 'd_tofu';
    const fixed = relinkBatches(deepFreeze(broken));
    assert.equal(fixed[idx].slots.lunch.leftoverOf, undefined);
    assert.equal(fixed[idx - 1].slots.dinner.batchNote, undefined);
    assert.notEqual(fixed, broken);
  }
});

test('grocery list consolidates each ingredient once and credits staples', () => {
  const { plan } = unwrap(solvePlan(deepFreeze(plannerInput({ ceiling: 1400 }))));
  const list = buildGroceryList(deepFreeze(plan.days), 2, [], 'ZAR');
  const keys = list.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(list.filter((i) => ['oil', 'spice', 'stock', 'garlic'].includes(i.key)).every((i) => i.pantryCredit));
  assert.deepEqual(buildGroceryList(plan.days, 2, [], 'ZAR'), list);
});

test('withAllSwaps returns a cheaper copy and leaves the original untouched', () => {
  const { plan } = unwrap(solvePlan(deepFreeze(plannerInput({ ceiling: 1400 }))));
  const frozen = deepFreeze(structuredClone(plan));
  const swapped = withAllSwaps(frozen);
  assert.ok(planCost(swapped.days, 2, [], 'ZAR') <= planCost(frozen.days, 2, [], 'ZAR'));
  assert.deepEqual(frozen, plan);
});
