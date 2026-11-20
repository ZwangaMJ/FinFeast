/**
 * Monthly budget engine (spec §4.3) and predictive analytics (spec §3.3).
 * Income − recurring expenses − committed goals = flexible money, split into envelopes.
 * The recurring-expense maths lives in the pure `recurring` module.
 */
import { addDays, daysBetween, daysInMonth, monthStart, parseIso, today, weekStart } from '@/lib/dates';
import {
  debitsTotal,
  essentialRecurringMonthly,
  flagLowBalanceDays,
  flexibleMoney,
  monthlyRecurringTotal,
  projectMonthBalances,
  recurringTransactionIds,
  scheduledDebits,
  type RiskDay,
  type ScheduledDebit,
} from '@/lib/recurring';
import type { Category, Goal, Income, MealPlan, RecurringExpense, Transaction } from '@/store/types';

export const VARIABLE_CATEGORIES: Category[] = ['food_grocery', 'food_dining', 'transport', 'shopping', 'entertainment', 'health', 'household', 'other'];
export const FOOD: Category[] = ['food_grocery', 'food_dining'];
const WEEKS_PER_MONTH = 52 / 12;

export const CATEGORY_LABEL: Record<Category, string> = {
  food_grocery: 'Groceries',
  food_dining: 'Eating out',
  transport: 'Transport',
  shopping: 'Shopping',
  entertainment: 'Entertainment',
  health: 'Health',
  household: 'Household',
  bills: 'Bills',
  income: 'Income',
  savings: 'Savings',
  other: 'Other',
};

export const CATEGORY_ICON: Record<Category, string> = {
  food_grocery: 'basket-outline',
  food_dining: 'fast-food-outline',
  transport: 'car-outline',
  shopping: 'bag-handle-outline',
  entertainment: 'film-outline',
  health: 'medkit-outline',
  household: 'home-outline',
  bills: 'calendar-outline',
  income: 'cash-outline',
  savings: 'leaf-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export function monthlyIncome(income: Income | null) {
  if (!income) return 0;
  const f = income.frequency === 'weekly' ? WEEKS_PER_MONTH : income.frequency === 'biweekly' ? 26 / 12 : 1;
  return income.net * f;
}

/** Active recurring expenses as a monthly amount (weekly and two-weekly converted). */
export function monthlyRecurring(expenses: RecurringExpense[]) {
  return monthlyRecurringTotal(expenses);
}

export function committedGoals(goals: Goal[]) {
  return goals.reduce((s, g) => s + g.monthlyCommitted, 0);
}

export function flexibleMonthly(income: Income | null, expenses: RecurringExpense[], goals: Goal[]) {
  return flexibleMoney(monthlyIncome(income), expenses, committedGoals(goals));
}

export function weeklyFlexible(income: Income | null, expenses: RecurringExpense[], goals: Goal[]) {
  return flexibleMonthly(income, expenses, goals) / WEEKS_PER_MONTH;
}

export function spend(tx: Transaction[], start: string, endExclusive: string, cats: Category[] = VARIABLE_CATEGORIES) {
  return tx.filter((t) => t.kind === 'expense' && cats.includes(t.category) && t.date >= start && t.date < endExclusive).reduce((s, t) => s + t.amount, 0);
}

/** Transactions that are habits, not payments of a saved recurring expense. */
export function discretionaryTransactions(tx: Transaction[], expenses: RecurringExpense[]) {
  if (!expenses.length) return tx;
  const recurring = recurringTransactionIds(expenses, tx);
  return recurring.size ? tx.filter((t) => !recurring.has(t.id)) : tx;
}

/** Food spend that counts against a plan: only since the plan existed. */
export function planWeekFoodSpend(tx: Transaction[], plan: MealPlan) {
  const created = plan.generatedAt.slice(0, 10);
  const from = created > plan.weekStart ? created : plan.weekStart;
  return spend(tx, from, addDays(plan.weekStart, 7), FOOD);
}

/** Share of the plan week covered since the plan was created (for honest comparisons). */
export function planCoverage(plan: MealPlan) {
  const created = plan.generatedAt.slice(0, 10);
  const from = created > plan.weekStart ? created : plan.weekStart;
  return Math.max(1, 7 - Math.max(0, daysBetween(plan.weekStart, from))) / 7;
}

/** Rolling 8-week monthly averages by category (the user's own baseline). */
export function categoryAverages(tx: Transaction[], weeks = 8) {
  const end = today();
  const start = addDays(end, -7 * weeks);
  const out: Partial<Record<Category, number>> = {};
  VARIABLE_CATEGORIES.forEach((c) => {
    out[c] = (spend(tx, start, addDays(end, 1), [c]) / weeks) * WEEKS_PER_MONTH;
  });
  return out;
}

export function hasHistory(tx: Transaction[]) {
  return tx.some((t) => t.date < addDays(today(), -21));
}

export type Forecast = {
  income: number;
  bills: number; // recurring debits scheduled this month
  goals: number;
  dynamic: number; // projected variable spend for the month
  spentSoFar: number;
  projectedEnd: number;
  band: number;
  points: { day: number; balance: number; actual: boolean }[];
  billMarkers: { day: number; name: string; amount: number }[];
  debits: ScheduledDebit[];
  /** Each day of the month with its debits; risky = projected balance below `buffer`. */
  riskDays: RiskDay[];
  buffer: number;
};

export function forecastMonth(income: Income | null, expenses: RecurringExpense[], goals: Goal[], tx: Transaction[], manualWeeklyFood: number): Forecast {
  const t = today();
  const ms = monthStart(t);
  const dim = daysInMonth(t);
  const dayOfMonth = Number(t.slice(8, 10));
  const inc = monthlyIncome(income);
  const goalsTotal = committedGoals(goals);
  // Payments of saved recurring expenses are scheduled below, so keep them out of the habit averages.
  const habits = discretionaryTransactions(tx, expenses);
  const avgs = categoryAverages(habits);
  let avgMonthly = VARIABLE_CATEGORIES.reduce((s, c) => s + (avgs[c] ?? 0), 0);
  if (!hasHistory(tx)) avgMonthly = Math.max(avgMonthly, manualWeeklyFood * WEEKS_PER_MONTH * 1.6);
  const avgDaily = avgMonthly / dim;
  const spentSoFar = spend(habits, ms, addDays(t, 1));
  const remainingDays = dim - dayOfMonth;
  const dynamic = spentSoFar + avgDaily * remainingDays;

  // Weekly variability → confidence band
  const weekly: number[] = [];
  for (let w = 1; w <= 8; w++) {
    const s = addDays(weekStart(t), -7 * w);
    weekly.push(spend(habits, s, addDays(s, 7)));
  }
  const mean = weekly.reduce((a, b) => a + b, 0) / weekly.length;
  const sd = Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / weekly.length);
  const band = Math.max(avgMonthly * 0.05, sd * Math.sqrt(Math.max(1, remainingDays / 7)));

  const debits = scheduledDebits(expenses, dim);
  const billsTotal = debitsTotal(debits);
  const points = projectMonthBalances({
    daysInMonth: dim,
    openingBalance: inc - goalsTotal,
    debits,
    actualThroughDay: dayOfMonth,
    spendForDay: (d) => {
      if (d > dayOfMonth) return avgDaily;
      const date = `${ms.slice(0, 8)}${String(d).padStart(2, '0')}`;
      return spend(habits, date, addDays(date, 1));
    },
  });
  // A day is risky when the balance would fall below about a week of usual spending.
  const buffer = Math.max(0, avgDaily * 7);
  return {
    income: inc,
    bills: billsTotal,
    goals: goalsTotal,
    dynamic,
    spentSoFar,
    projectedEnd: inc - billsTotal - goalsTotal - dynamic,
    band,
    points: points.map(({ day, balance, actual }) => ({ day, balance, actual })),
    billMarkers: debits.map(({ day, name, amount }) => ({ day, name, amount })),
    debits,
    riskDays: flagLowBalanceDays(points, debits, buffer, dayOfMonth),
    buffer,
  };
}

/**
 * Average eating-out spend per weekday over the last 8 weeks (risky-day prediction).
 * A day is risky when it runs over 2× the user's own daily average.
 */
export function riskyDays(tx: Transaction[], minAmount = 50) {
  const end = today();
  const start = addDays(end, -56);
  const totals = [0, 0, 0, 0, 0, 0, 0];
  tx.filter((t) => t.kind === 'expense' && t.category === 'food_dining' && t.date >= start && t.date <= end).forEach((t) => {
    totals[parseIso(t.date).getDay()] += t.amount;
  });
  const avg = totals.map((v) => v / 8);
  const max = Math.max(1, ...avg);
  const mean = avg.reduce((a, b) => a + b, 0) / 7;
  return avg.map((v, day) => ({
    day,
    avg: v,
    intensity: v / max,
    ratio: mean > 0 ? v / mean : 0,
    risky: mean > 0 && v > mean * 2 && v > minAmount,
  }));
}

/** Essential recurring expenses (fixed costs) plus food, per month: what a safety net must cover. */
export function essentialsMonthly(expenses: RecurringExpense[], weeklyFood: number) {
  return essentialRecurringMonthly(expenses) + weeklyFood * WEEKS_PER_MONTH;
}

export function emergencyTarget(expenses: RecurringExpense[], weeklyFood: number, months = 3) {
  return Math.ceil((essentialsMonthly(expenses, weeklyFood) * months) / 500) * 500;
}

export function safetyNetDays(goals: Goal[], expenses: RecurringExpense[], weeklyFood: number) {
  const ef = goals.find((g) => g.type === 'emergency');
  const perDay = essentialsMonthly(expenses, weeklyFood) / 30;
  if (!ef || perDay <= 0) return 0;
  return Math.floor(ef.current / perDay);
}

/** 0 = one paycheck from trouble → 100 = 6-month fund + active investments. */
export function securityMeter(goals: Goal[], expenses: RecurringExpense[], weeklyFood: number) {
  const ef = goals.find((g) => g.type === 'emergency');
  const essentials = essentialsMonthly(expenses, weeklyFood);
  const months = ef && essentials > 0 ? ef.current / essentials : 0;
  const invest = goals.some((g) => g.type === 'investment' && g.current > 0) ? 15 : 0;
  return { score: Math.round(Math.min(85, (months / 6) * 85) + invest), months };
}

export function monthsToGoal(g: Goal, extraMonthly = 0) {
  const remaining = Math.max(0, g.target - g.current);
  const rate = g.monthlyCommitted + extraMonthly;
  if (remaining === 0) return 0;
  if (rate <= 0) return Infinity;
  return Math.ceil(remaining / rate);
}

export function lastNWeeks(n: number) {
  const ws = weekStart(today());
  return Array.from({ length: n }, (_, i) => addDays(ws, -7 * (n - 1 - i)));
}
