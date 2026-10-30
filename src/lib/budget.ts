/**
 * Monthly budget engine (spec §4.3) and predictive analytics (spec §3.3).
 * Income − fixed bills − committed goals = flexible money, split into envelopes.
 */
import { addDays, daysBetween, daysInMonth, monthStart, parseIso, today, weekStart, weekday } from '@/lib/dates';
import type { Bill, Category, Goal, Income, MealPlan, Transaction } from '@/store/types';

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

export function billMonthly(b: Bill) {
  return b.cadence === 'weekly' ? b.amount * WEEKS_PER_MONTH : b.amount;
}

export function monthlyBills(bills: Bill[]) {
  return bills.filter((b) => b.active).reduce((s, b) => s + billMonthly(b), 0);
}

export function committedGoals(goals: Goal[]) {
  return goals.reduce((s, g) => s + g.monthlyCommitted, 0);
}

export function flexibleMonthly(income: Income | null, bills: Bill[], goals: Goal[]) {
  return monthlyIncome(income) - monthlyBills(bills) - committedGoals(goals);
}

export function weeklyFlexible(income: Income | null, bills: Bill[], goals: Goal[]) {
  return flexibleMonthly(income, bills, goals) / WEEKS_PER_MONTH;
}

export function spend(tx: Transaction[], start: string, endExclusive: string, cats: Category[] = VARIABLE_CATEGORIES) {
  return tx.filter((t) => t.kind === 'expense' && cats.includes(t.category) && t.date >= start && t.date < endExclusive).reduce((s, t) => s + t.amount, 0);
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
  bills: number;
  goals: number;
  dynamic: number; // projected variable spend for the month
  spentSoFar: number;
  projectedEnd: number;
  band: number;
  points: { day: number; balance: number; actual: boolean }[];
  billMarkers: { day: number; name: string; amount: number }[];
};

export function forecastMonth(income: Income | null, bills: Bill[], goals: Goal[], tx: Transaction[], manualWeeklyFood: number): Forecast {
  const t = today();
  const ms = monthStart(t);
  const dim = daysInMonth(t);
  const dayOfMonth = Number(t.slice(8, 10));
  const inc = monthlyIncome(income);
  const billsTotal = monthlyBills(bills);
  const goalsTotal = committedGoals(goals);
  const avgs = categoryAverages(tx);
  let avgMonthly = VARIABLE_CATEGORIES.reduce((s, c) => s + (avgs[c] ?? 0), 0);
  if (!hasHistory(tx)) avgMonthly = Math.max(avgMonthly, manualWeeklyFood * WEEKS_PER_MONTH * 1.6);
  const avgDaily = avgMonthly / dim;
  const spentSoFar = spend(tx, ms, addDays(t, 1));
  const remainingDays = dim - dayOfMonth;
  const dynamic = spentSoFar + avgDaily * remainingDays;

  // Weekly variability → confidence band
  const weekly: number[] = [];
  for (let w = 1; w <= 8; w++) {
    const s = addDays(weekStart(t), -7 * w);
    weekly.push(spend(tx, s, addDays(s, 7)));
  }
  const mean = weekly.reduce((a, b) => a + b, 0) / weekly.length;
  const sd = Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / weekly.length);
  const band = Math.max(avgMonthly * 0.05, sd * Math.sqrt(Math.max(1, remainingDays / 7)));

  const billMarkers = bills.filter((b) => b.active && b.cadence === 'monthly').map((b) => ({ day: Math.min(b.day, dim), name: b.name, amount: b.amount }));
  const points: Forecast['points'] = [];
  let bal = inc - goalsTotal;
  for (let d = 1; d <= dim; d++) {
    const date = `${ms.slice(0, 8)}${String(d).padStart(2, '0')}`;
    billMarkers.filter((b) => b.day === d).forEach((b) => (bal -= b.amount));
    bills.filter((b) => b.active && b.cadence === 'weekly' && weekday(date) === 1).forEach((b) => (bal -= b.amount));
    bal -= d <= dayOfMonth ? spend(tx, date, addDays(date, 1)) : avgDaily;
    points.push({ day: d, balance: bal, actual: d <= dayOfMonth });
  }
  return {
    income: inc,
    bills: billsTotal,
    goals: goalsTotal,
    dynamic,
    spentSoFar,
    projectedEnd: inc - billsTotal - goalsTotal - dynamic,
    band,
    points,
    billMarkers,
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

export function essentialsMonthly(bills: Bill[], weeklyFood: number) {
  return monthlyBills(bills.filter((b) => !b.isSubscription)) + weeklyFood * WEEKS_PER_MONTH;
}

export function emergencyTarget(bills: Bill[], weeklyFood: number, months = 3) {
  return Math.ceil((essentialsMonthly(bills, weeklyFood) * months) / 500) * 500;
}

export function safetyNetDays(goals: Goal[], bills: Bill[], weeklyFood: number) {
  const ef = goals.find((g) => g.type === 'emergency');
  const perDay = essentialsMonthly(bills, weeklyFood) / 30;
  if (!ef || perDay <= 0) return 0;
  return Math.floor(ef.current / perDay);
}

/** 0 = one paycheck from trouble → 100 = 6-month fund + active investments. */
export function securityMeter(goals: Goal[], bills: Bill[], weeklyFood: number) {
  const ef = goals.find((g) => g.type === 'emergency');
  const essentials = essentialsMonthly(bills, weeklyFood);
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
