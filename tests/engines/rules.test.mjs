import assert from 'node:assert/strict';
import test from 'node:test';

import { fixedEnv } from '../../src/lib/env.ts';
import { solvePlan } from '../../src/lib/mealPlanner.ts';
import { addFoundMoney, allocateFoundMoney, applyRoundUps, deleteGoal, routeFoundMoney, syncTime } from '../../src/store/rules.ts';
import { AS_OF, appData, deepFreeze, goal, plannerInput, tx } from './fixtures.mjs';

const env = fixedEnv(AS_OF, { idPrefix: 'x-' });
const fm = (overrides = {}) => ({ id: 'fm1', amount: 300, headline: 'Saved', source: 'test', kind: 'grocery_underspend', createdAt: AS_OF, status: 'pending', ...overrides });

test('meal-plan surplus rule sweeps grocery underspend straight into its goal', () => {
  const out = routeFoundMoney(deepFreeze(fm()), deepFreeze([goal()]), env);
  assert.equal(out.foundMoney[0].status, 'allocated');
  assert.equal(out.foundMoney[0].auto, true);
  assert.equal(out.goals[0].current, 300);
  assert.deepEqual(out.goals[0].contributions, [{ id: 'x-0', date: AS_OF, amount: 300, source: 'Meal-plan surplus sweep' }]);
});

test('percent rules split found money and leave the unruled remainder waiting', () => {
  const goals = [goal({ rules: [{ id: 'p', kind: 'percent', percent: 60, enabled: true }] }), goal({ id: 'hol', type: 'short_term', name: 'Holiday', rules: [] })];
  const out = routeFoundMoney(deepFreeze(fm({ kind: 'subscription', amount: 100 })), deepFreeze(goals), env);
  assert.deepEqual(out.foundMoney.map((f) => [f.status, f.amount]), [['allocated', 60], ['pending', 40]]);
  assert.equal(out.goals[0].current, 60);
  assert.equal(out.goals[1].current, 0);
});

test('no rules → found money waits in the inbox untouched', () => {
  const out = routeFoundMoney(deepFreeze(fm({ kind: 'subscription' })), deepFreeze([goal({ rules: [] })]), env);
  assert.equal(out.foundMoney[0].status, 'pending');
  assert.equal(out.goals[0].current, 0);
});

test('adding and allocating found money is deterministic for a fixed env', () => {
  const s = deepFreeze({ foundMoney: [], goals: [goal({ rules: [] })] });
  const added = addFoundMoney(s, { amount: 250, headline: 'R250 freed', source: 's', kind: 'subscription' }, env);
  assert.deepEqual(added, addFoundMoney(s, { amount: 250, headline: 'R250 freed', source: 's', kind: 'subscription' }, env));
  const [card] = added.foundMoney;
  assert.equal(card.id, 'x-0');
  const after = allocateFoundMoney(deepFreeze(added), card.id, [{ goalId: 'ef', amount: 200 }], env);
  assert.deepEqual(after.foundMoney.map((f) => [f.status, f.amount]), [['allocated', 200], ['kept', 50]]);
  assert.equal(after.goals[0].current, 200);
});

test('deleting a goal returns its allocations to the inbox', () => {
  const s = deepFreeze({ goals: [goal(), goal({ id: 'hol', name: 'Holiday' })], foundMoney: [fm({ status: 'allocated', allocations: [{ goalId: 'ef', amount: 100 }, { goalId: 'hol', amount: 200 }] })] });
  const out = deleteGoal(s, 'hol', env);
  assert.deepEqual(out.goals.map((g) => g.id), ['ef']);
  assert.deepEqual(out.foundMoney.map((f) => [f.status, f.amount]), [['allocated', 100], ['pending', 200]]);
});

test('food round-ups credit the rounding difference only for food spend', () => {
  const goals = [goal({ rules: [{ id: 'ru', kind: 'roundup', amount: 10, enabled: true }] })];
  const out = applyRoundUps(deepFreeze([tx(AS_OF, 43.5, 'food_grocery'), tx(AS_OF, 17, 'transport')]), deepFreeze(goals), env);
  assert.equal(out[0].current, 6.5);
});

test('week rollover: last week under plan → found money swept to the goal, fresh plan for this week', () => {
  const lastWeek = solvePlan(deepFreeze(plannerInput({ weekStart: '2026-11-02', generatedAt: '2026-11-02T08:00:00.000Z', ceiling: 1400 })));
  assert.equal(lastWeek.ok, true);
  const s = deepFreeze(appData({ plan: lastWeek.value.plan, transactions: [tx('2026-11-03', 400, 'food_grocery')] }));
  const next = syncTime(s, env);
  assert.equal(next.weekHistory.length, 1);
  assert.equal(next.weekHistory[0].actual, 400);
  assert.equal(next.foundMoney.length, 1);
  assert.equal(next.foundMoney[0].status, 'allocated');
  assert.ok(next.goals[0].current > 0);
  assert.equal(next.plan.weekStart, '2026-11-09');
  assert.equal(next.plan.mode, 'normal');
  // Pure: same state + env → same result, and a second run has nothing left to do
  assert.deepEqual(syncTime(s, env), next);
  assert.equal(syncTime(deepFreeze(next), env), next);
});

test('week rollover: more than 10% over plan → next week is budget-light', () => {
  const lastWeek = solvePlan(deepFreeze(plannerInput({ weekStart: '2026-11-02', generatedAt: '2026-11-02T08:00:00.000Z', ceiling: 1400 })));
  const s = deepFreeze(appData({ plan: lastWeek.value.plan, transactions: [tx('2026-11-03', 5000, 'food_dining')] }));
  const next = syncTime(s, env);
  assert.equal(next.foundMoney.length, 0);
  assert.equal(next.plan.mode, 'budget_light');
});

test('payday sweep runs once per pay cycle', () => {
  const goals = [goal({ rules: [{ id: 'fx', kind: 'fixed', amount: 500, enabled: true }] })];
  const payday = fixedEnv('2026-11-25', { idPrefix: 'p-' });
  const s = deepFreeze(appData({ goals, plan: { weekStart: '2026-11-23' } }));
  const once = syncTime(s, payday);
  assert.equal(once.goals[0].current, 500);
  assert.equal(once.lastPaydayProcessed, '2026-11-25');
  assert.equal(syncTime(deepFreeze(once), payday).goals[0].current, 500);
});

test('not onboarded → time rules do nothing', () => {
  const s = deepFreeze(appData({ onboarded: false }));
  assert.equal(syncTime(s, env), s);
});
