import assert from 'node:assert/strict';
import test from 'node:test';

import { addDays } from '../../src/lib/dates.ts';
import { calculateMealSwapSurplus, generateInsights, priorityScore } from '../../src/lib/insights.ts';
import { solvePlan, withAllSwaps } from '../../src/lib/mealPlanner.ts';
import { AS_OF, bill, daily, deepFreeze, goal, income, plannerInput, tx } from './fixtures.mjs';

const base = (overrides = {}) => ({
  bills: [],
  transactions: [],
  goals: [goal()],
  plan: null,
  income: null,
  weeklyFoodBudget: 0,
  householdSize: 2,
  currency: 'ZAR',
  dismissed: [],
  assignedWeeks: [],
  asOf: AS_OF,
  ...overrides,
});

const streamFit = bill({ id: 'sf', name: 'StreamFit', amount: 99, day: 28, isSubscription: true, usageNote: 'opened once in 7 months', monthsPaid: 7 });

test('nothing to say for an empty profile', () => {
  assert.deepEqual(generateInsights(deepFreeze(base())), []);
});

test('insights are deterministic and never mutate their input', () => {
  const input = deepFreeze(base({ bills: [streamFit], income: income(), weeklyFoodBudget: 800, transactions: daily(AS_OF, 56, 90, 'food_dining') }));
  assert.deepEqual(generateInsights(input), generateInsights(input));
});

test('ranking follows (money × actionability) ÷ effort, highest first', () => {
  const insights = generateInsights(deepFreeze(base({ bills: [streamFit, bill({ id: 'mp', name: 'MusicPlus', amount: 69, isSubscription: true })] })));
  assert.deepEqual(insights.map((i) => i.id), ['sub-sf', 'sub-mp']);
  assert.equal(insights[0].score, priorityScore({ amountMonthly: 99, actionability: 0.9, effort: 1 }));
  assert.equal(insights[1].score, priorityScore({ amountMonthly: 69, actionability: 0.4, effort: 1 }));
  assert.equal(insights[0].destinationGoalId, 'ef');
  assert.match(insights[0].detail, /Emergency Fund/);
});

test('dismissed insights and amounts under the R50/mo threshold are dropped', () => {
  const tiny = bill({ id: 'tiny', name: 'Tiny', amount: 20, isSubscription: true });
  const insights = generateInsights(deepFreeze(base({ bills: [streamFit, tiny], dismissed: ['sub-sf'] })));
  assert.deepEqual(insights, []);
});

test('copy never uses shaming words', () => {
  const insights = generateInsights(
    deepFreeze(base({ bills: [streamFit], income: income(), weeklyFoodBudget: 600, transactions: [...daily(AS_OF, 56, 180, 'food_dining'), ...daily(addDays(AS_OF, 1), 7, 300, 'shopping')] })),
  );
  assert.ok(insights.length >= 2);
  assert.ok(insights.every((i) => !/overspen|bad with money|you failed|wast(ed|ing) money/i.test(`${i.headline} ${i.detail}`)));
});

test('spend velocity ahead of a bill becomes a nudge with the amount at stake', () => {
  const baseline = daily(addDays(AS_OF, -6), 28, 40, 'shopping');
  const recent = daily(addDays(AS_OF, 1), 7, 160, 'shopping');
  const insights = generateInsights(deepFreeze(base({ bills: [bill({ day: 13 })], transactions: [...baseline, ...recent] })));
  const v = insights.find((i) => i.type === 'velocity');
  assert.ok(v, insights.map((i) => i.id).join());
  assert.equal(v.amountMonthly, 360); // (160 − 40) × 3 days until Rent
  assert.match(v.headline, /^Ease the pace before Rent/);
  assert.equal(v.action.kind, 'plan');
});

test('a Friday takeaway habit produces a dining nudge naming the day', () => {
  const fridays = Array.from({ length: 8 }, (_, i) => tx(addDays('2026-11-06', -7 * i), 220, 'food_dining'));
  const insights = generateInsights(deepFreeze(base({ transactions: fridays })));
  const dining = insights.find((i) => i.type === 'dining');
  assert.ok(dining);
  assert.match(dining.detail, /^Fridays average/);
});

test('calculateMealSwapSurplus: frugal swaps free money without breaking the nutrition floor', () => {
  const r = solvePlan(deepFreeze(plannerInput({ ceiling: 1500 })));
  assert.equal(r.ok, true);
  const plan = deepFreeze(r.value.plan);
  const ctx = { householdSize: 2, pantry: [], currency: 'ZAR', calorieTarget: 0 };
  const surplus = calculateMealSwapSurplus(plan, withAllSwaps(plan), ctx);
  assert.ok(surplus.weeklySurplus > 0);
  assert.ok(surplus.mealsChanged > 0);
  assert.ok(surplus.perDay.every((d) => d.kcalDelta === 0 && d.proteinDelta === 0)); // swaps keep the dish
  assert.equal(surplus.monthlySurplus, Math.round(surplus.weeklySurplus * (52 / 12) * 100) / 100);
  assert.equal(surplus.worthIt, surplus.nutritionFloorRespected);

  const same = calculateMealSwapSurplus(plan, plan, ctx);
  assert.equal(same.weeklySurplus, 0);
  assert.equal(same.mealsChanged, 0);
  assert.equal(same.worthIt, false);
});

test('unassigned flexible money is offered once per week', () => {
  const input = base({ income: income(30000), bills: [bill()], weeklyFoodBudget: 800 });
  const first = generateInsights(deepFreeze(input));
  assert.ok(first.some((i) => i.id === 'realloc-2026-11-09'));
  const later = generateInsights(deepFreeze({ ...input, assignedWeeks: ['2026-11-09'] }));
  assert.ok(!later.some((i) => i.type === 'reallocation'));
});
