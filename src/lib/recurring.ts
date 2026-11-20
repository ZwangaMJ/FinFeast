/**
 * Recurring expenses engine: monthly equivalents, flexible money, debit
 * scheduling on billing days, low-balance flags, bill creep and fixed-cost
 * ratio. Pure and free of runtime imports so node:test can load it directly.
 */
import type { RecurringCategory, RecurringExpense, RecurringFrequency, Transaction } from '@/store/types';

export const RECURRING_CATEGORIES: RecurringCategory[] = ['housing', 'transport', 'utilities', 'insurance', 'debt', 'subscriptions', 'other'];

export const RECURRING_CATEGORY_LABEL: Record<RecurringCategory, string> = {
  housing: 'Housing',
  transport: 'Transport',
  utilities: 'Utilities',
  subscriptions: 'Subscriptions',
  insurance: 'Insurance',
  debt: 'Debt repayments',
  other: 'Other',
};

export const RECURRING_CATEGORY_ICON: Record<RecurringCategory, string> = {
  housing: 'home-outline',
  transport: 'bus-outline',
  utilities: 'flash-outline',
  subscriptions: 'repeat-outline',
  insurance: 'umbrella-outline',
  debt: 'card-outline',
  other: 'calendar-outline',
};

export const FREQUENCIES: RecurringFrequency[] = ['monthly', 'weekly', 'biweekly'];
export const FREQUENCY_LABEL: Record<RecurringFrequency, string> = { monthly: 'Monthly', weekly: 'Weekly', biweekly: 'Every 2 weeks' };
export const FREQUENCY_SHORT: Record<RecurringFrequency, string> = { monthly: 'mo', weekly: 'wk', biweekly: '2 wks' };

const PER_MONTH: Record<RecurringFrequency, number> = { monthly: 1, weekly: 52 / 12, biweekly: 26 / 12 };

/** New expenses in these categories default to "essential". */
export function defaultEssential(category: RecurringCategory): boolean {
  return category !== 'subscriptions' && category !== 'other';
}

export function isSubscription(expense: Pick<RecurringExpense, 'category'>): boolean {
  return expense.category === 'subscriptions';
}

/** Average monthly cost: weekly × 52/12, every two weeks × 26/12. */
export function monthlyAmount(expense: Pick<RecurringExpense, 'amount' | 'frequency'>): number {
  return expense.amount * (PER_MONTH[expense.frequency] ?? 1);
}

export function monthlyRecurringTotal(expenses: readonly RecurringExpense[], include: (expense: RecurringExpense) => boolean = () => true): number {
  return expenses.filter((expense) => expense.active && include(expense)).reduce((sum, expense) => sum + monthlyAmount(expense), 0);
}

export function essentialRecurringMonthly(expenses: readonly RecurringExpense[]): number {
  return monthlyRecurringTotal(expenses, (expense) => expense.isEssential);
}

/** Flexible money = income − recurring expenses − committed goals, all monthly. */
export function flexibleMoney(monthlyIncome: number, expenses: readonly RecurringExpense[], committedGoals: number): number {
  return monthlyIncome - monthlyRecurringTotal(expenses) - committedGoals;
}

function clampDay(day: number, daysInMonth: number): number {
  const rounded = Math.round(Number(day));
  return Math.min(Math.max(1, Number.isFinite(rounded) ? rounded : 1), daysInMonth);
}

/**
 * Days of a month an expense is debited. Monthly debits leave on the billing day
 * (the last day in shorter months). Weekly and two-weekly debits repeat every 7
 * or 14 days through the month from the billing day.
 */
export function debitDaysInMonth(expense: Pick<RecurringExpense, 'billingDayOfMonth' | 'frequency'>, daysInMonth: number): number[] {
  const anchor = clampDay(expense.billingDayOfMonth, daysInMonth);
  if (expense.frequency === 'monthly') return [anchor];
  const step = expense.frequency === 'weekly' ? 7 : 14;
  const days: number[] = [];
  for (let day = ((anchor - 1) % step) + 1; day <= daysInMonth; day += step) days.push(day);
  return days;
}

export type ScheduledDebit = {
  day: number;
  id: string;
  name: string;
  amount: number;
  category: RecurringCategory;
  isEssential: boolean;
};

/** Every active debit in a month, placed on its billing day, in date order. */
export function scheduledDebits(expenses: readonly RecurringExpense[], daysInMonth: number): ScheduledDebit[] {
  return expenses
    .filter((expense) => expense.active && expense.amount > 0)
    .flatMap((expense) =>
      debitDaysInMonth(expense, daysInMonth).map((day) => ({
        day,
        id: expense.id,
        name: expense.name,
        amount: expense.amount,
        category: expense.category,
        isEssential: expense.isEssential,
      })),
    )
    .sort((a, b) => a.day - b.day || b.amount - a.amount);
}

export function debitsTotal(debits: readonly ScheduledDebit[]): number {
  return debits.reduce((sum, debit) => sum + debit.amount, 0);
}

export type DayBalance = { day: number; balance: number; debits: number; actual: boolean };

/**
 * Balance at the end of each day of a month. Each scheduled debit leaves on its
 * own day; spendForDay covers everything else (actual spend for past days, the
 * usual daily spend for future ones).
 */
export function projectMonthBalances(input: {
  daysInMonth: number;
  openingBalance: number;
  debits: readonly ScheduledDebit[];
  spendForDay: (day: number) => number;
  actualThroughDay: number;
}): DayBalance[] {
  const points: DayBalance[] = [];
  let balance = input.openingBalance;
  for (let day = 1; day <= input.daysInMonth; day++) {
    const debits = debitsTotal(input.debits.filter((debit) => debit.day === day));
    balance -= debits + input.spendForDay(day);
    points.push({ day, balance, debits, actual: day <= input.actualThroughDay });
  }
  return points;
}

export type RiskDay = { day: number; balance: number; debits: number; debitNames: string[]; risky: boolean; past: boolean };

/**
 * Flags days, from `fromDay` on, whose projected closing balance drops below
 * `buffer`, so a low-balance day shows up before it happens. Days before
 * `fromDay` are history and never flagged.
 */
export function flagLowBalanceDays(points: readonly DayBalance[], debits: readonly ScheduledDebit[], buffer: number, fromDay: number): RiskDay[] {
  return points.map((point) => ({
    day: point.day,
    balance: point.balance,
    debits: point.debits,
    debitNames: debits.filter((debit) => debit.day === point.day).map((debit) => debit.name),
    risky: point.day >= fromDay && point.balance < buffer,
    past: point.day < fromDay,
  }));
}

/** Lower-case words only, without payment-rail noise, for name matching. */
export function normalizeExpenseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\b(?:debit order|debicheck|edo|eft|internet|payment|pmt|to|from|ref|the|pty|ltd|za|sa|monthly|subscription)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesMatch(a: string, b: string): boolean {
  const left = normalizeExpenseName(a);
  const right = normalizeExpenseName(b);
  if (!left || !right) return false;
  return left === right || (left.length >= 4 && right.includes(left)) || (right.length >= 4 && left.includes(right));
}

/** Statement or manual expense transactions that pay this recurring expense. */
export function matchedTransactions(expense: Pick<RecurringExpense, 'name'>, transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((transaction) => transaction.kind === 'expense' && namesMatch(expense.name, transaction.merchant));
}

/** Ids of transactions that pay a saved recurring expense (kept out of habit averages). */
export function recurringTransactionIds(expenses: readonly RecurringExpense[], transactions: readonly Transaction[]): Set<string> {
  const ids = new Set<string>();
  expenses.forEach((expense) => matchedTransactions(expense, transactions).forEach((transaction) => ids.add(transaction.id)));
  return ids;
}

export type CategoryPlan = { category: RecurringCategory; scheduled: number; dueSoFar: number; paid: number; next: ScheduledDebit | null };

/**
 * Plan vs actual per recurring category for one month: what is scheduled, what
 * was due by today, and what matching transactions show was paid.
 */
export function recurringCategoryPlan(input: {
  expenses: readonly RecurringExpense[];
  transactions: readonly Transaction[];
  monthStart: string; // yyyy-mm-01
  daysInMonth: number;
  today: number; // day of month
}): CategoryPlan[] {
  const debits = scheduledDebits(input.expenses, input.daysInMonth);
  const monthPrefix = input.monthStart.slice(0, 7);
  return RECURRING_CATEGORIES.flatMap((category) => {
    const inCategory = debits.filter((debit) => debit.category === category);
    if (!inCategory.length) return [];
    const expenses = input.expenses.filter((expense) => expense.active && expense.category === category);
    const paid = expenses.reduce(
      (sum, expense) => sum + matchedTransactions(expense, input.transactions).filter((transaction) => transaction.date.startsWith(monthPrefix)).reduce((s, t) => s + t.amount, 0),
      0,
    );
    return [{
      category,
      scheduled: debitsTotal(inCategory),
      dueSoFar: debitsTotal(inCategory.filter((debit) => debit.day <= input.today)),
      paid,
      next: inCategory.find((debit) => debit.day > input.today) ?? null,
    }];
  });
}

export type FixedCostRatio = { housing: number; transport: number; total: number; ratio: number };

/** Share of net monthly income that goes to housing and transport. */
export function fixedCostRatio(expenses: readonly RecurringExpense[], monthlyIncome: number): FixedCostRatio | null {
  if (!(monthlyIncome > 0)) return null;
  const housing = monthlyRecurringTotal(expenses, (expense) => expense.category === 'housing');
  const transport = monthlyRecurringTotal(expenses, (expense) => expense.category === 'transport');
  if (housing + transport <= 0) return null;
  return { housing, transport, total: housing + transport, ratio: (housing + transport) / monthlyIncome };
}

export type RecurringCreep = { expense: RecurringExpense; from: number; to: number; since: string | null; monthlyIncrease: number };

// Utility bills move with usage, so a higher bill there is not price creep.
const CREEP_CATEGORIES: RecurringCategory[] = ['housing', 'transport', 'subscriptions', 'insurance', 'debt', 'other'];

/**
 * Recurring bills whose charge went up: the latest matching transaction is at
 * least 5% (and `minIncrease`) above the earliest one, or above the saved amount.
 */
export function recurringCreep(expenses: readonly RecurringExpense[], transactions: readonly Transaction[], minIncrease = 10): RecurringCreep[] {
  return expenses.flatMap((expense) => {
    if (!expense.active || !CREEP_CATEGORIES.includes(expense.category)) return [];
    const paid = matchedTransactions(expense, transactions).sort((a, b) => a.date.localeCompare(b.date));
    if (!paid.length) return [];
    const latest = paid[paid.length - 1];
    const earliest = paid.length > 1 ? paid[0] : null;
    const from = earliest && earliest.amount < expense.amount ? earliest.amount : expense.amount;
    const to = latest.amount;
    const increase = to - from;
    if (increase < minIncrease || to < from * 1.05) return [];
    return [{
      expense,
      from,
      to,
      since: earliest && earliest.amount === from ? earliest.date : null,
      monthlyIncrease: monthlyAmount({ amount: increase, frequency: expense.frequency }),
    }];
  });
}

type LegacyBill = {
  id?: unknown;
  name?: unknown;
  amount?: unknown;
  day?: unknown;
  cadence?: unknown;
  confidence?: unknown;
  active?: unknown;
  isSubscription?: unknown;
  usageNote?: unknown;
  monthsPaid?: unknown;
};

/** Maps a bill saved before recurring expenses existed. */
export function fromLegacyBill(bill: LegacyBill, index = 0): RecurringExpense {
  const subscription = bill.isSubscription === true;
  const confidence = bill.confidence === 'high' || bill.confidence === 'medium' || bill.confidence === 'low' ? bill.confidence : undefined;
  return {
    id: typeof bill.id === 'string' && bill.id ? bill.id : `legacy-bill-${index + 1}`,
    name: typeof bill.name === 'string' && bill.name ? bill.name : 'Bill',
    amount: Number.isFinite(Number(bill.amount)) ? Number(bill.amount) : 0,
    category: subscription ? 'subscriptions' : 'other',
    billingDayOfMonth: clampDay(Number(bill.day), 31),
    frequency: bill.cadence === 'weekly' ? 'weekly' : 'monthly',
    isEssential: !subscription,
    source: 'bank_statement',
    active: bill.active !== false,
    ...(confidence ? { confidence } : {}),
    ...(typeof bill.usageNote === 'string' && bill.usageNote ? { usageNote: bill.usageNote } : {}),
    ...(Number.isFinite(Number(bill.monthsPaid)) && bill.monthsPaid !== null && bill.monthsPaid !== undefined ? { monthsPaid: Number(bill.monthsPaid) } : {}),
  };
}

/** Recurring expenses from saved data, upgrading a pre-existing `bills` list. */
export function recurringExpensesFromSaved(recurringExpenses: unknown, legacyBills: unknown): RecurringExpense[] {
  if (Array.isArray(recurringExpenses)) return recurringExpenses as RecurringExpense[];
  if (Array.isArray(legacyBills)) return legacyBills.map((bill, index) => fromLegacyBill((bill ?? {}) as LegacyBill, index));
  return [];
}
