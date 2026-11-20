import assert from 'node:assert/strict';
import test from 'node:test';

import {
  debitDaysInMonth,
  essentialRecurringMonthly,
  fixedCostRatio,
  flagLowBalanceDays,
  flexibleMoney,
  monthlyAmount,
  projectMonthBalances,
  recurringCategoryPlan,
  recurringCreep,
  recurringExpensesFromSaved,
  recurringTransactionIds,
  scheduledDebits,
} from '../src/lib/recurring.ts';

function expense(overrides) {
  return {
    id: overrides.name.toLowerCase().replace(/\W+/g, '-'),
    amount: 100,
    category: 'other',
    billingDayOfMonth: 1,
    frequency: 'monthly',
    isEssential: true,
    source: 'manual',
    active: true,
    ...overrides,
  };
}

function tx(merchant, amount, date, overrides = {}) {
  return { id: `${merchant}-${date}`, date, merchant, amount, kind: 'expense', category: 'bills', confidence: 'high', ...overrides };
}

const rent = expense({ name: 'Rent', amount: 7000, category: 'housing', billingDayOfMonth: 1 });
const gym = expense({ name: 'Gym', amount: 100, category: 'subscriptions', frequency: 'weekly', isEssential: false });
const taxi = expense({ name: 'Taxi fare', amount: 300, category: 'transport', frequency: 'biweekly', billingDayOfMonth: 6 });
const cancelled = expense({ name: 'Showmax', amount: 200, category: 'subscriptions', isEssential: false, active: false });

test('flexible money deducts recurring expenses, converting weekly and two-weekly amounts to monthly', () => {
  assert.equal(monthlyAmount(rent), 7000);
  assert.equal(Math.round(monthlyAmount(gym) * 100) / 100, 433.33); // 100 × 52 / 12
  assert.equal(monthlyAmount(taxi), 650); // 300 × 26 / 12

  const flexible = flexibleMoney(20000, [rent, gym, taxi, cancelled], 1000);
  assert.equal(Math.round(flexible * 100) / 100, 10916.67); // 20000 − 7000 − 433.33 − 650 − 1000; cancelled ignored
});

test('only essential, active recurring expenses count toward the safety-net runway', () => {
  assert.equal(essentialRecurringMonthly([rent, gym, taxi, cancelled]), 7650);
});

test('debits are placed on their billing day, repeating weekly or every two weeks, clamped in short months', () => {
  assert.deepEqual(debitDaysInMonth({ billingDayOfMonth: 15, frequency: 'monthly' }, 30), [15]);
  assert.deepEqual(debitDaysInMonth({ billingDayOfMonth: 31, frequency: 'monthly' }, 28), [28]);
  assert.deepEqual(debitDaysInMonth({ billingDayOfMonth: 3, frequency: 'weekly' }, 31), [3, 10, 17, 24, 31]);
  assert.deepEqual(debitDaysInMonth({ billingDayOfMonth: 20, frequency: 'biweekly' }, 30), [6, 20]);

  const debits = scheduledDebits([rent, taxi, cancelled], 30);
  assert.deepEqual(debits.map((d) => [d.day, d.name]), [[1, 'Rent'], [6, 'Taxi fare'], [20, 'Taxi fare']]);
});

test('a low-balance day is flagged on the billing date the debit leaves, not before', () => {
  const debit = (day) => scheduledDebits([expense({ name: 'Rent', amount: 6000, category: 'housing', billingDayOfMonth: day })], 30);
  const riskFor = (day) => {
    const debits = debit(day);
    const points = projectMonthBalances({ daysInMonth: 30, openingBalance: 10000, debits, spendForDay: () => 100, actualThroughDay: 0 });
    return { points, days: flagLowBalanceDays(points, debits, 3000, 1) };
  };

  const mid = riskFor(15);
  assert.equal(mid.points[13].balance, 8600); // day 14: 10000 − 14 × 100
  assert.equal(mid.points[14].balance, 2500); // day 15: rent leaves
  assert.equal(mid.points[14].debits, 6000);
  assert.equal(mid.days.find((d) => d.risky)?.day, 15);
  assert.deepEqual(mid.days[14].debitNames, ['Rent']);
  assert.ok(mid.days.slice(0, 14).every((d) => !d.risky));

  // Moving the billing day moves the flagged day with it.
  assert.equal(riskFor(20).days.find((d) => d.risky)?.day, 20);
});

test('days before today are history and are never flagged', () => {
  const debits = scheduledDebits([expense({ name: 'Bond', amount: 9000, category: 'housing', billingDayOfMonth: 2 })], 30);
  const points = projectMonthBalances({ daysInMonth: 30, openingBalance: 10000, debits, spendForDay: () => 0, actualThroughDay: 10 });
  const days = flagLowBalanceDays(points, debits, 2000, 10);
  assert.ok(days.slice(0, 9).every((d) => !d.risky && d.past));
  assert.ok(days[9].risky); // today, balance 1000 < 2000
  assert.ok(points.slice(0, 10).every((p) => p.actual));
});

test('fixed-cost ratio is the housing and transport share of net income', () => {
  const ratio = fixedCostRatio([rent, taxi, gym], 20000);
  assert.equal(ratio.housing, 7000);
  assert.equal(ratio.transport, 650);
  assert.equal(ratio.ratio, 7650 / 20000);
  assert.equal(fixedCostRatio([gym], 20000), null);
  assert.equal(fixedCostRatio([rent], 0), null);
});

test('detects creep when a recurring bill is charged more than before, but not for usage-based utilities', () => {
  const netflix = expense({ name: 'Netflix', amount: 159, category: 'subscriptions', isEssential: false });
  const power = expense({ name: 'City of Joburg electricity', amount: 800, category: 'utilities' });
  const transactions = [
    tx('NETFLIX.COM', 159, '2025-01-15'),
    tx('NETFLIX.COM', 199, '2025-03-15'),
    tx('City of Joburg electricity', 800, '2025-01-03'),
    tx('City of Joburg electricity', 1100, '2025-03-03'),
  ];
  const creep = recurringCreep([netflix, power], transactions);
  assert.equal(creep.length, 1);
  assert.equal(creep[0].expense.name, 'Netflix');
  assert.equal(creep[0].from, 159);
  assert.equal(creep[0].to, 199);
  assert.equal(creep[0].since, '2025-01-15');
  assert.equal(creep[0].monthlyIncrease, 40);
  assert.deepEqual(recurringCreep([netflix], [tx('Netflix', 159, '2025-03-15')]), []);
});

test('payments of saved recurring expenses are told apart from everyday habits', () => {
  const netflix = expense({ name: 'Netflix', amount: 199, category: 'subscriptions', billingDayOfMonth: 15 });
  const transactions = [tx('Netflix.com', 199, '2025-03-15'), tx('Kwikspar', 300, '2025-03-15', { category: 'food_grocery' })];
  assert.deepEqual([...recurringTransactionIds([netflix], transactions)], ['Netflix.com-2025-03-15']);

  const plan = recurringCategoryPlan({ expenses: [netflix, rent], transactions, monthStart: '2025-03-01', daysInMonth: 31, today: 10 });
  assert.deepEqual(plan.map((p) => [p.category, p.scheduled, p.dueSoFar, p.paid, p.next?.name ?? null]), [
    ['housing', 7000, 7000, 0, null],
    ['subscriptions', 199, 0, 199, 'Netflix'],
  ]);
});

test('bills saved before recurring expenses existed are upgraded', () => {
  const upgraded = recurringExpensesFromSaved(undefined, [
    { id: 'b1', name: 'Netflix', amount: 99, day: 5, cadence: 'monthly', confidence: 'high', active: true, isSubscription: true, monthsPaid: 3 },
    { id: 'b2', name: 'Finchoice', amount: 500, day: 31, cadence: 'weekly', confidence: 'medium', active: false, isSubscription: false },
  ]);
  assert.deepEqual(upgraded[0], {
    id: 'b1', name: 'Netflix', amount: 99, category: 'subscriptions', billingDayOfMonth: 5, frequency: 'monthly',
    isEssential: false, source: 'bank_statement', active: true, confidence: 'high', monthsPaid: 3,
  });
  assert.equal(upgraded[1].isEssential, true);
  assert.equal(upgraded[1].frequency, 'weekly');
  assert.equal(upgraded[1].active, false);
  assert.deepEqual(recurringExpensesFromSaved([rent], [{ id: 'old' }]), [rent]);
  assert.deepEqual(recurringExpensesFromSaved(undefined, undefined), []);
});
