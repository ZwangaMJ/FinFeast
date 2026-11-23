/**
 * Monthly budget engine (spec §4.3) and predictive analytics (spec §3.3).
 * Income − fixed bills − committed goals = flexible money, split into envelopes.
 *
 * Every function here is pure: dates arrive as an explicit `asOf` (yyyy-mm-dd),
 * inputs are readonly and never mutated, and outputs are fresh values.
 */
import { addDays, daysBetween, daysInMonth, monthStart, parseIso, weekStart, weekday } from '@/lib/dates';
import { all, clamp01, filterBy, mean, pipe, range, round2, scan, stdDev, sumBy, type DeepReadonly } from '@/lib/fp';
import type { Bill, Category, Goal, Income, MealPlan, Transaction } from '@/store/types';

type Tx = DeepReadonly<Transaction>;
type Bills = readonly DeepReadonly<Bill>[];
type Goals = readonly DeepReadonly<Goal>[];
type Plan = DeepReadonly<MealPlan>;

export const VARIABLE_CATEGORIES: readonly Category[] = ['food_grocery', 'food_dining', 'transport', 'shopping', 'entertainment', 'health', 'household', 'other'];
export const FOOD: readonly Category[] = ['food_grocery', 'food_dining'];
/** Spending that tends to be impulsive rather than planned. */
export const DISCRETIONARY: readonly Category[] = ['food_dining', 'shopping', 'entertainment'];
const WEEKS_PER_MONTH = 52 / 12;

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
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

export const CATEGORY_ICON: Readonly<Record<Category, string>> = {
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

// ---------------------------------------------------------------------------
// Income, bills and flexible money

export function monthlyIncome(income: DeepReadonly<Income> | null) {
  if (!income) return 0;
  const f = income.frequency === 'weekly' ? WEEKS_PER_MONTH : income.frequency === 'biweekly' ? 26 / 12 : 1;
  return income.net * f;
}

export const billMonthly = (b: DeepReadonly<Bill>) => (b.cadence === 'weekly' ? b.amount * WEEKS_PER_MONTH : b.amount);

export const monthlyBills = (bills: Bills) => pipe(bills, filterBy((b) => b.active), sumBy(billMonthly));

export const committedGoals = (goals: Goals) => sumBy((g: DeepReadonly<Goal>) => g.monthlyCommitted)(goals);

export const flexibleMonthly = (income: DeepReadonly<Income> | null, bills: Bills, goals: Goals) => monthlyIncome(income) - monthlyBills(bills) - committedGoals(goals);

export const weeklyFlexible = (income: DeepReadonly<Income> | null, bills: Bills, goals: Goals) => flexibleMonthly(income, bills, goals) / WEEKS_PER_MONTH;

// ---------------------------------------------------------------------------
// Transaction predicates and spend

export const isExpense = (t: Tx) => t.kind === 'expense';
export const inCategories = (cats: readonly Category[]) => (t: Tx) => cats.includes(t.category);
export const inWindow = (start: string, endExclusive: string) => (t: Tx) => t.date >= start && t.date < endExclusive;

export const spend = (tx: readonly Tx[], start: string, endExclusive: string, cats: readonly Category[] = VARIABLE_CATEGORIES) =>
  pipe(tx, filterBy(all(isExpense, inCategories(cats), inWindow(start, endExclusive))), sumBy((t: Tx) => t.amount));

/** First day a plan's spending counts from: the later of its week start and creation date. */
const planStartDay = (plan: Plan) => {
  const created = plan.generatedAt.slice(0, 10);
  return created > plan.weekStart ? created : plan.weekStart;
};

/** Food spend that counts against a plan: only since the plan existed. */
export const planWeekFoodSpend = (tx: readonly Tx[], plan: Plan) => spend(tx, planStartDay(plan), addDays(plan.weekStart, 7), FOOD);

/** Share of the plan week covered since the plan was created (for honest comparisons). */
export const planCoverage = (plan: Plan) => Math.max(1, 7 - Math.max(0, daysBetween(plan.weekStart, planStartDay(plan)))) / 7;

/** Rolling monthly averages by category over the last `weeks` weeks (the user's own baseline). */
export function categoryAverages(tx: readonly Tx[], asOf: string, weeks = 8): Readonly<Partial<Record<Category, number>>> {
  const start = addDays(asOf, -7 * weeks);
  const end = addDays(asOf, 1);
  return Object.fromEntries(VARIABLE_CATEGORIES.map((c) => [c, (spend(tx, start, end, [c]) / weeks) * WEEKS_PER_MONTH]));
}

export const hasHistory = (tx: readonly Tx[], asOf: string) => tx.some((t) => t.date < addDays(asOf, -21));

export function lastNWeeks(n: number, asOf: string): readonly string[] {
  const ws = weekStart(asOf);
  return range(n).map((i) => addDays(ws, -7 * (n - 1 - i)));
}

// ---------------------------------------------------------------------------
// Month cashflow forecast

export type ForecastInput = DeepReadonly<{
  income: Income | null;
  bills: Bill[];
  goals: Goal[];
  transactions: Transaction[];
  weeklyFoodBudget: number;
  asOf: string;
}>;

export type ForecastPoint = Readonly<{ day: number; balance: number; actual: boolean }>;

export type Forecast = Readonly<{
  income: number;
  bills: number;
  goals: number;
  dynamic: number; // projected variable spend for the month
  spentSoFar: number;
  projectedEnd: number;
  band: number;
  points: readonly ForecastPoint[];
  billMarkers: readonly Readonly<{ day: number; name: string; amount: number }>[];
}>;

/** Weekly variable spend for the `n` complete weeks before `asOf`'s week. */
const priorWeeklySpend = (tx: readonly Tx[], asOf: string, n: number) =>
  range(n).map((w) => {
    const s = addDays(weekStart(asOf), -7 * (w + 1));
    return spend(tx, s, addDays(s, 7));
  });

/** Average variable spend per month; without history, a cautious estimate from the food budget. */
const baselineMonthlySpend = (tx: readonly Tx[], asOf: string, weeklyFood: number) => {
  const avgs = categoryAverages(tx, asOf);
  const avg = VARIABLE_CATEGORIES.reduce((s, c) => s + (avgs[c] ?? 0), 0);
  return hasHistory(tx, asOf) ? avg : Math.max(avg, weeklyFood * WEEKS_PER_MONTH * 1.6);
};

/**
 * income − bills (day-precise) − rolling average of dynamic spend − committed goals
 * → projected end-of-month balance with a confidence band.
 */
export function forecastMonth(input: ForecastInput): Forecast {
  const { income, bills, goals, transactions: tx, weeklyFoodBudget, asOf } = input;
  const ms = monthStart(asOf);
  const dim = daysInMonth(asOf);
  const dayOfMonth = Number(asOf.slice(8, 10));
  const inc = monthlyIncome(income);
  const billsTotal = monthlyBills(bills);
  const goalsTotal = committedGoals(goals);
  const avgMonthly = baselineMonthlySpend(tx, asOf, weeklyFoodBudget);
  const avgDaily = avgMonthly / dim;
  const spentSoFar = spend(tx, ms, addDays(asOf, 1));
  const remainingDays = dim - dayOfMonth;

  const sd = stdDev(priorWeeklySpend(tx, asOf, 8));
  const band = Math.max(avgMonthly * 0.05, sd * Math.sqrt(Math.max(1, remainingDays / 7)));

  const billMarkers = bills.filter((b) => b.active && b.cadence === 'monthly').map((b) => ({ day: Math.min(b.day, dim), name: b.name, amount: b.amount }));
  const weeklyBills = bills.filter((b) => b.active && b.cadence === 'weekly');

  const outflowOn = (d: number) => {
    const date = `${ms.slice(0, 8)}${String(d).padStart(2, '0')}`;
    const monthlyDue = sumBy((b: { day: number; amount: number }) => b.amount)(billMarkers.filter((b) => b.day === d));
    const weeklyDue = weekday(date) === 1 ? sumBy((b: DeepReadonly<Bill>) => b.amount)(weeklyBills) : 0;
    const variable = d <= dayOfMonth ? spend(tx, date, addDays(date, 1)) : avgDaily;
    return monthlyDue + weeklyDue + variable;
  };

  const days = range(dim).map((i) => i + 1);
  const points = scan<number, ForecastPoint>(days, (prev, d) => ({ day: d, balance: prev.balance - outflowOn(d), actual: d <= dayOfMonth }), {
    day: 0,
    balance: inc - goalsTotal,
    actual: true,
  });
  const dynamic = spentSoFar + avgDaily * remainingDays;
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

// ---------------------------------------------------------------------------
// Spend velocity: impulse spending accelerating ahead of known bills

export type UpcomingBill = Readonly<{
  billId: string;
  name: string;
  amount: number;
  dueDate: string;
  daysUntil: number;
  /** Discretionary spend expected before the bill at the current pace. */
  projectedSpendBeforeDue: number;
  /** How much more than the user's usual pace that is. */
  excessBeforeDue: number;
}>;

export type SpendVelocity = Readonly<{
  recentDaily: number;
  baselineDaily: number;
  /** recent ÷ baseline pace; null when there's no baseline to compare with. */
  acceleration: number | null;
  upcomingBills: readonly UpcomingBill[];
  alert: boolean;
}>;

export type VelocityInput = DeepReadonly<{
  transactions: Transaction[];
  bills: Bill[];
  asOf: string;
  recentDays?: number;
  baselineDays?: number;
  horizonDays?: number;
  /** Minimum excess (in the user's currency) before raising an alert. */
  minExcess?: number;
}>;

/** Next date a bill is due on or after `asOf`. Weekly bills fall on Mondays, as in the forecast. */
export function nextDueDate(bill: DeepReadonly<Bill>, asOf: string): string {
  if (bill.cadence === 'weekly') return addDays(asOf, (8 - weekday(asOf)) % 7);
  const thisMonth = `${asOf.slice(0, 8)}${String(Math.min(bill.day, daysInMonth(asOf))).padStart(2, '0')}`;
  if (thisMonth >= asOf) return thisMonth;
  const nextMonth = addDays(monthStart(asOf), daysInMonth(asOf));
  return `${nextMonth.slice(0, 8)}${String(Math.min(bill.day, daysInMonth(nextMonth))).padStart(2, '0')}`;
}

export function spendVelocity(input: VelocityInput): SpendVelocity {
  const { transactions: tx, bills, asOf, recentDays = 7, baselineDays = 28, horizonDays = 7, minExcess = 50 } = input;
  const recentStart = addDays(asOf, 1 - recentDays);
  const baselineStart = addDays(recentStart, -baselineDays);
  const recentDaily = spend(tx, recentStart, addDays(asOf, 1), DISCRETIONARY) / recentDays;
  const baselineDaily = spend(tx, baselineStart, recentStart, DISCRETIONARY) / baselineDays;
  const acceleration = baselineDaily > 0 ? recentDaily / baselineDaily : null;

  const upcomingBills = bills
    .filter((b) => b.active)
    .map((b) => {
      const dueDate = nextDueDate(b, asOf);
      const daysUntil = daysBetween(asOf, dueDate);
      return {
        billId: b.id,
        name: b.name,
        amount: b.amount,
        dueDate,
        daysUntil,
        projectedSpendBeforeDue: round2(recentDaily * daysUntil),
        excessBeforeDue: round2(Math.max(0, recentDaily - baselineDaily) * daysUntil),
      };
    })
    .filter((b) => b.daysUntil <= horizonDays)
    .sort((a, b) => a.daysUntil - b.daysUntil || b.amount - a.amount);

  const biggestExcess = upcomingBills.reduce((m, b) => Math.max(m, b.excessBeforeDue), 0);
  const alert = acceleration !== null && acceleration >= 1.5 && upcomingBills.length > 0 && biggestExcess >= minExcess;
  return { recentDaily: round2(recentDaily), baselineDaily: round2(baselineDaily), acceleration: acceleration === null ? null : round2(acceleration), upcomingBills, alert };
}

// ---------------------------------------------------------------------------
// Habit prediction: Risky Day Score (0.0–1.0) per weekday

export type RiskyDay = Readonly<{
  day: number; // 0 = Sunday … 6 = Saturday
  avg: number; // average eating-out spend on this weekday
  intensity: number; // avg ÷ highest weekday avg (for the heat strip)
  ratio: number; // avg ÷ the user's own daily average
  score: number; // 0.0 – 1.0
  risky: boolean;
  drivers: Readonly<{ history: number; planDeviation: number; velocity: number }>;
}>;

export type HabitInput = DeepReadonly<{
  transactions: Transaction[];
  asOf: string;
  plan?: MealPlan | null;
  bills?: Bill[];
  /** Weekday averages below this never count as risky on history alone. */
  minAmount?: number;
  weeks?: number;
}>;

export const RISKY_DAY_WEIGHTS = { history: 0.6, planDeviation: 0.25, velocity: 0.15 } as const;
export const RISKY_DAY_THRESHOLD = 0.4;

type Weekly = readonly number[]; // indexed by weekday

/** Stage 1 — average eating-out spend per weekday over the window. */
const diningByWeekday = (tx: readonly Tx[], asOf: string, weeks: number): Weekly => {
  const start = addDays(asOf, -7 * weeks);
  const dining = tx.filter(all(isExpense, inCategories(['food_dining']), (t: Tx) => t.date >= start && t.date <= asOf));
  return range(7).map((d) => sumBy((t: Tx) => t.amount)(dining.filter((t) => parseIso(t.date).getDay() === d)) / weeks);
};

/** Stage 2 — how far each weekday runs above the user's own norm: ratio 1 → 0, ratio ≥ 2.5 → 1. */
const historySignal = (avg: Weekly, minAmount: number): Weekly => {
  const norm = mean(avg);
  return avg.map((v) => (norm > 0 && v > minAmount ? clamp01((v / norm - 1) / 1.5) : 0));
};

/**
 * Stage 3 — meal-plan deviation on past plan days: a planned dinner that wasn't
 * cooked counts 0.5, and 1.0 when the user also ate out that day.
 */
const planDeviationSignal = (plan: Plan | null | undefined, tx: readonly Tx[], asOf: string): Weekly => {
  if (!plan) return range(7).map(() => 0);
  const past = plan.days.filter((d) => d.date < asOf);
  return range(7).map((wd) => {
    const samples = past
      .filter((d) => weekday(d.date) === wd)
      .map((d) => (d.slots.dinner.cooked ? 0 : spend(tx, d.date, addDays(d.date, 1), ['food_dining']) > 0 ? 1 : 0.5));
    return samples.length ? mean(samples) : 0;
  });
};

/** Stage 4 — spending acceleration ahead of bills, as a 0–1 pressure applied to every day. */
const velocitySignal = (v: SpendVelocity | null): number =>
  v && v.acceleration !== null && v.upcomingBills.length ? clamp01((v.acceleration - 1) / 1.5) : 0;

/**
 * Habit prediction pipeline: dining history → normalised against the user's
 * baseline → blended with plan deviations and spend velocity → Risky Day Score.
 */
export function riskyDays(input: HabitInput): readonly RiskyDay[] {
  const { transactions: tx, asOf, plan, bills, minAmount = 50, weeks = 8 } = input;
  const avg = diningByWeekday(tx, asOf, weeks);
  const history = historySignal(avg, minAmount);
  const deviation = planDeviationSignal(plan, tx, asOf);
  const velocity = velocitySignal(bills ? spendVelocity({ transactions: tx, bills, asOf }) : null);
  const max = Math.max(1, ...avg);
  const norm = mean(avg);
  return avg.map((v, day) => {
    const drivers = { history: round2(history[day]), planDeviation: round2(deviation[day]), velocity: round2(velocity) };
    const score = round2(
      clamp01(RISKY_DAY_WEIGHTS.history * drivers.history + RISKY_DAY_WEIGHTS.planDeviation * drivers.planDeviation + RISKY_DAY_WEIGHTS.velocity * drivers.velocity),
    );
    return { day, avg: v, intensity: v / max, ratio: norm > 0 ? v / norm : 0, score, risky: score > RISKY_DAY_THRESHOLD, drivers };
  });
}

// ---------------------------------------------------------------------------
// Safety net & goals

export const essentialsMonthly = (bills: Bills, weeklyFood: number) => monthlyBills(bills.filter((b) => !b.isSubscription)) + weeklyFood * WEEKS_PER_MONTH;

export const emergencyTarget = (bills: Bills, weeklyFood: number, months = 3) => Math.ceil((essentialsMonthly(bills, weeklyFood) * months) / 500) * 500;

export function safetyNetDays(goals: Goals, bills: Bills, weeklyFood: number) {
  const ef = goals.find((g) => g.type === 'emergency');
  const perDay = essentialsMonthly(bills, weeklyFood) / 30;
  if (!ef || perDay <= 0) return 0;
  return Math.floor(ef.current / perDay);
}

/** 0 = one paycheck from trouble → 100 = 6-month fund + active investments. */
export function securityMeter(goals: Goals, bills: Bills, weeklyFood: number) {
  const ef = goals.find((g) => g.type === 'emergency');
  const essentials = essentialsMonthly(bills, weeklyFood);
  const months = ef && essentials > 0 ? ef.current / essentials : 0;
  const invest = goals.some((g) => g.type === 'investment' && g.current > 0) ? 15 : 0;
  return { score: Math.round(Math.min(85, (months / 6) * 85) + invest), months };
}

export function monthsToGoal(g: DeepReadonly<Goal>, extraMonthly = 0) {
  const remaining = Math.max(0, g.target - g.current);
  const rate = g.monthlyCommitted + extraMonthly;
  if (remaining === 0) return 0;
  if (rate <= 0) return Infinity;
  return Math.ceil(remaining / rate);
}
