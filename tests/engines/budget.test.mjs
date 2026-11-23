import assert from 'node:assert/strict';
import test from 'node:test';

import { forecastMonth, nextDueDate, riskyDays, RISKY_DAY_THRESHOLD, spendVelocity } from '../../src/lib/budget.ts';
import { addDays, weekday } from '../../src/lib/dates.ts';
import { AS_OF, bill, daily, deepFreeze, goal, income, tx } from './fixtures.mjs';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// ---------------------------------------------------------------------------
// Cashflow forecasting

test('forecast: an empty profile forecasts zeros, not NaN', () => {
  const f = forecastMonth(deepFreeze({ income: null, bills: [], goals: [], transactions: [], weeklyFoodBudget: 0, asOf: AS_OF }));
  assert.equal(f.income, 0);
  assert.equal(f.projectedEnd, 0);
  assert.equal(f.band, 0);
  assert.equal(f.points.length, 30); // November
  assert.ok(f.points.every((p) => p.balance === 0 && Number.isFinite(p.balance)));
});

test('forecast: end balance equals income − bills − goals − projected variable spend', () => {
  const input = deepFreeze({
    income: income(20000),
    bills: [bill({ amount: 5000, day: 1 }), bill({ id: 'phone', name: 'Phone', amount: 600, day: 31 })],
    goals: [goal({ monthlyCommitted: 1000 })],
    transactions: [],
    weeklyFoodBudget: 700,
    asOf: AS_OF,
  });
  const f = forecastMonth(input);
  close(f.projectedEnd, f.income - f.bills - f.goals - f.dynamic);
  close(f.points[f.points.length - 1].balance, f.projectedEnd);
  // No history → cautious baseline from the food budget (×1.6), spread over the remaining 20 days
  close(f.dynamic, ((700 * 52) / 12) * 1.6 * (20 / 30));
  // A bill on the 31st lands on the last day of a 30-day month
  assert.deepEqual(f.billMarkers.map((b) => b.day), [1, 30]);
  assert.equal(f.points.filter((p) => p.actual).length, 10);
});

test('forecast: overspending goes negative and the band widens with volatile weeks', () => {
  const steady = daily(AS_OF, 60, 100, 'shopping');
  const volatile = daily(AS_OF, 60, 100, 'shopping').map((t, i) => ({ ...t, amount: i % 7 === 0 ? 1500 : 20 }));
  const base = { income: income(3000), bills: [bill({ amount: 2500 })], goals: [], weeklyFoodBudget: 0, asOf: AS_OF };
  const a = forecastMonth(deepFreeze({ ...base, transactions: steady }));
  const b = forecastMonth(deepFreeze({ ...base, transactions: volatile }));
  assert.ok(a.projectedEnd < 0);
  assert.ok(b.band > a.band);
});

test('forecast is deterministic and does not mutate its input', () => {
  const input = deepFreeze({ income: income(), bills: [bill()], goals: [goal()], transactions: daily(AS_OF, 40, 80, 'food_dining'), weeklyFoodBudget: 600, asOf: AS_OF });
  assert.deepEqual(forecastMonth(input), forecastMonth(input));
});

// ---------------------------------------------------------------------------
// Spend velocity ahead of bills

test('velocity: impulse spend tripling before a bill due in 3 days raises an alert', () => {
  const baseline = daily(addDays(AS_OF, -6), 28, 50, 'food_dining');
  const recent = daily(addDays(AS_OF, 1), 7, 150, 'shopping');
  const v = spendVelocity(deepFreeze({ transactions: [...baseline, ...recent], bills: [bill({ day: 13 })], asOf: AS_OF }));
  assert.equal(v.recentDaily, 150);
  assert.equal(v.baselineDaily, 50);
  assert.equal(v.acceleration, 3);
  assert.equal(v.upcomingBills[0].dueDate, '2026-11-13');
  assert.equal(v.upcomingBills[0].daysUntil, 3);
  assert.equal(v.upcomingBills[0].excessBeforeDue, 300);
  assert.equal(v.alert, true);
});

test('velocity: no baseline means no acceleration and no alert', () => {
  const v = spendVelocity(deepFreeze({ transactions: daily(addDays(AS_OF, 1), 7, 200, 'shopping'), bills: [bill({ day: 12 })], asOf: AS_OF }));
  assert.equal(v.acceleration, null);
  assert.equal(v.alert, false);
});

test('velocity: steady spending and far-off bills stay quiet', () => {
  const steady = daily(addDays(AS_OF, 1), 35, 60, 'food_dining');
  const v = spendVelocity(deepFreeze({ transactions: steady, bills: [bill({ day: 30 })], asOf: AS_OF }));
  assert.equal(v.acceleration, 1);
  assert.deepEqual(v.upcomingBills, []);
  assert.equal(v.alert, false);
});

test('nextDueDate handles short months, passed days and weekly bills', () => {
  assert.equal(nextDueDate(bill({ day: 31 }), AS_OF), '2026-11-30');
  assert.equal(nextDueDate(bill({ day: 5 }), AS_OF), '2026-12-05');
  assert.equal(nextDueDate(bill({ day: 31 }), '2027-02-10'), '2027-02-28');
  assert.equal(weekday(nextDueDate(bill({ cadence: 'weekly' }), AS_OF)), 1);
  assert.equal(nextDueDate(bill({ cadence: 'weekly' }), '2026-11-09'), '2026-11-09');
});

// ---------------------------------------------------------------------------
// Habit prediction: Risky Day Score

const fridays = (count, amount) => Array.from({ length: count }, (_, i) => tx(addDays('2026-11-06', -7 * i), amount, 'food_dining'));

test('risky days: a Friday takeaway habit scores high; other days score 0', () => {
  const days = riskyDays(deepFreeze({ transactions: fridays(8, 200), asOf: AS_OF }));
  const friday = days[5];
  assert.ok(friday.score > RISKY_DAY_THRESHOLD, `friday ${friday.score}`);
  assert.equal(friday.risky, true);
  assert.equal(friday.drivers.history, 1);
  assert.ok(days.filter((d) => d.day !== 5).every((d) => d.score === 0 && !d.risky));
  assert.ok(days.every((d) => d.score >= 0 && d.score <= 1));
});

test('risky days: no history gives all-zero scores without NaN', () => {
  const days = riskyDays(deepFreeze({ transactions: [], asOf: AS_OF }));
  assert.equal(days.length, 7);
  assert.ok(days.every((d) => d.score === 0 && d.ratio === 0 && Number.isFinite(d.intensity)));
});

test('risky days: a skipped planned dinner plus a takeaway raises that weekday', () => {
  const dinner = (cooked) => ({ breakfast: { recipeId: 'b_oats', swaps: [] }, lunch: { recipeId: 'l_tuna_wrap', swaps: [] }, dinner: { recipeId: 'd_hake', swaps: [], cooked } });
  const plan = {
    weekStart: '2026-11-09',
    days: [
      { date: '2026-11-09', slots: dinner(false), snacks: [] },
      { date: '2026-11-10', slots: dinner(false), snacks: [] },
    ],
    ceiling: 1000,
    mode: 'normal',
    status: 'ok',
    shortfall: 0,
    generatedAt: '2026-11-09T08:00:00.000Z',
    seed: 1,
  };
  const transactions = [tx('2026-11-09', 180, 'food_dining')];
  const withPlan = riskyDays(deepFreeze({ transactions, asOf: AS_OF, plan }));
  const withoutPlan = riskyDays(deepFreeze({ transactions, asOf: AS_OF }));
  assert.equal(withPlan[1].drivers.planDeviation, 1); // Monday: not cooked, ate out
  assert.ok(withPlan[1].score > withoutPlan[1].score);
  assert.equal(withPlan[2].drivers.planDeviation, 0); // Tuesday is today, not yet past
});

test('risky days: spending acceleration adds pressure to every day', () => {
  const baseline = daily(addDays(AS_OF, -6), 28, 30, 'shopping');
  const recent = daily(addDays(AS_OF, 1), 7, 120, 'shopping');
  const input = { transactions: [...baseline, ...recent, ...fridays(8, 200)], asOf: AS_OF };
  const calm = riskyDays(deepFreeze({ ...input, bills: [] }));
  const pressured = riskyDays(deepFreeze({ ...input, bills: [bill({ day: 12 })] }));
  assert.equal(calm[3].drivers.velocity, 0);
  assert.equal(pressured[3].drivers.velocity, 1);
  assert.ok(pressured.every((d, i) => d.score >= calm[i].score));
});

test('risky days are deterministic for the same input', () => {
  const input = deepFreeze({ transactions: [...fridays(8, 220), ...daily(AS_OF, 20, 40, 'food_dining')], asOf: AS_OF, bills: [bill({ day: 12 })] });
  assert.deepEqual(riskyDays(input), riskyDays(input));
});
