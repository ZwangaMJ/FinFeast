/**
 * Pure rule handlers behind the store: the found-money engine (spec §5.1) and the
 * time-driven triggers (week rollover, payday sweeps, month-end checks).
 *
 * Shape: (State, Inputs, Env) → next State or a state patch. No clock, no
 * randomness, no mutation — the store passes in `systemEnv()` and applies the result.
 */
import { emergencyTarget, flexibleMonthly, planCoverage, planWeekFoodSpend, spend } from '@/lib/budget';
import { addDays, daysBetween, monthName, monthStart, weekStart } from '@/lib/dates';
import { idFor, scopeEnv, type Env } from '@/lib/env';
import { pipe, round2, sum } from '@/lib/fp';
import { money } from '@/lib/format';
import { lockSlots, planCost, planOrFallback, solvePlan, type PlannerBase } from '@/lib/mealPlanner';
import type { AppData, Category, FoundMoney, Goal, MealPlan, Transaction } from './types';

type Allocation = { goalId: string; amount: number };
export type FoundMoneyInput = Omit<FoundMoney, 'id' | 'createdAt' | 'status'>;
export type MoneyPatch = Pick<AppData, 'foundMoney' | 'goals'>;

const FOOD_CATS: readonly Category[] = ['food_grocery', 'food_dining'];

// ---------------------------------------------------------------------------
// Planning

export const plannerBase = (s: AppData, mode: MealPlan['mode'] = 'normal'): PlannerBase => ({
  profile: s.profile,
  ceiling: s.weeklyFoodBudget,
  pantry: s.pantry.map((p) => p.key),
  tried: s.tried,
  mode,
});

/** A fresh week (or the honest cheapest week on a budget conflict); null if no recipes fit. */
export function planWeek(s: AppData, env: Env, opts: { mode?: MealPlan['mode']; weekStart?: string; lockedFrom?: MealPlan; lockBeforeDay?: number } = {}): MealPlan | null {
  const { lockedFrom, lockBeforeDay = 0 } = opts;
  return planOrFallback(
    solvePlan({
      ...plannerBase(s, opts.mode),
      weekStart: opts.weekStart ?? weekStart(env.today),
      seed: env.seed,
      generatedAt: env.now,
      locked: lockedFrom ? lockSlots(lockedFrom, (d) => d < lockBeforeDay) : undefined,
    }),
  );
}

/** Day index of `env.today` within a plan's week, clamped to 0–7. */
export const planDayIndex = (plan: MealPlan, env: Env) => Math.max(0, Math.min(7, daysBetween(plan.weekStart, env.today)));

// ---------------------------------------------------------------------------
// Goals

/** Adds money to one goal and records the contribution. */
export function creditGoal(goals: readonly Goal[], goalId: string, amount: number, source: string, env: Env, n = 0): Goal[] {
  return goals.map((g) =>
    g.id === goalId ? { ...g, current: Math.max(0, g.current + amount), contributions: [{ id: idFor(env, n), date: env.today, amount, source }, ...g.contributions] } : g,
  );
}

/** Applies a list of credits in order, each with its own contribution id. */
const creditAll = (goals: readonly Goal[], credits: readonly (Allocation & { source: string })[], env: Env): Goal[] =>
  credits.reduce<Goal[]>((gs, c, i) => creditGoal(gs, c.goalId, c.amount, c.source, env, i), [...goals]);

/** Creates (or re-targets, while still untouched) the Emergency Fund from essentials. */
export function ensureEmergencyGoal(s: Pick<AppData, 'bills' | 'weeklyFoodBudget' | 'goals'>, env: Env): Goal[] {
  const target = emergencyTarget(s.bills, s.weeklyFoodBudget);
  const existing = s.goals.find((g) => g.type === 'emergency');
  if (target <= 0) return s.goals;
  if (existing) return s.goals.map((g) => (g.id === existing.id && g.contributions.length === 0 && g.current === 0 ? { ...g, target } : g));
  return [
    {
      id: idFor(env, 0),
      type: 'emergency',
      name: 'Emergency Fund',
      target,
      current: 0,
      deadline: null,
      monthlyCommitted: 0,
      rules: [{ id: idFor(env, 1), kind: 'meal_surplus', enabled: true }],
      contributions: [],
      createdAt: env.today,
    },
    ...s.goals,
  ];
}

/** Food round-up rule: round each new food transaction up to the nearest step. */
export function applyRoundUps(txs: readonly Transaction[], goals: readonly Goal[], env: Env): Goal[] {
  const food = txs.filter((t) => t.kind === 'expense' && FOOD_CATS.includes(t.category));
  const credits = goals.flatMap((g) =>
    g.rules
      .filter((r) => r.kind === 'roundup' && r.enabled)
      .map((r) => {
        const step = r.amount || 10;
        return { goalId: g.id, amount: round2(sum(food.map((t) => Math.ceil(t.amount / step) * step - t.amount))), source: 'Food round-ups' };
      })
      .filter((c) => c.amount > 0),
  );
  return creditAll(goals, credits, env);
}

// ---------------------------------------------------------------------------
// Found Money

/** Routes found money through the user's opt-in rules; unruled money waits in the inbox. */
export function routeFoundMoney(fm: FoundMoney, goals: readonly Goal[], env: Env): MoneyPatch {
  if (fm.kind === 'grocery_underspend') {
    const target = goals.find((g) => g.rules.some((r) => r.kind === 'meal_surplus' && r.enabled));
    if (target) {
      return {
        foundMoney: [{ ...fm, status: 'allocated', auto: true, allocations: [{ goalId: target.id, amount: fm.amount }] }],
        goals: creditGoal(goals, target.id, fm.amount, 'Meal-plan surplus sweep', env),
      };
    }
  }
  const splits = goals.flatMap((g) => g.rules.filter((r) => r.kind === 'percent' && r.enabled && r.percent).map((r) => ({ goalId: g.id, percent: r.percent! })));
  if (!splits.length) return { foundMoney: [fm], goals: [...goals] };
  const totalPercent = Math.min(100, sum(splits.map((p) => p.percent)));
  const allocations = splits.map((p) => ({ goalId: p.goalId, amount: Math.round((fm.amount * p.percent) / 100) }));
  const rest = Math.round(fm.amount * (1 - totalPercent / 100));
  const allocated: FoundMoney = { ...fm, amount: sum(allocations.map((a) => a.amount)), status: 'allocated', auto: true, allocations };
  return {
    foundMoney: rest > 0 ? [allocated, { ...fm, id: idFor(env, 99), amount: rest, headline: `${fm.headline} (remainder)` }] : [allocated],
    goals: creditAll(goals, allocations.map((a) => ({ ...a, source: 'Found Money split rule' })), scopeEnv(env, 'split')),
  };
}

/** New found money, routed and prepended to the inbox. */
export function addFoundMoney(s: MoneyPatch, input: FoundMoneyInput, env: Env): MoneyPatch {
  const fm: FoundMoney = { ...input, id: idFor(env, 0), createdAt: env.today, status: 'pending' };
  const routed = routeFoundMoney(fm, s.goals, scopeEnv(env, 'route'));
  return { foundMoney: [...routed.foundMoney, ...s.foundMoney], goals: routed.goals };
}

/** The user's choice for one inbox card: send to goals (any remainder is kept for spending). */
export function allocateFoundMoney(s: MoneyPatch, id: string, allocations: readonly Allocation[], env: Env): MoneyPatch {
  const fm = s.foundMoney.find((f) => f.id === id);
  if (!fm) return s;
  const allocated = sum(allocations.map((a) => a.amount));
  const rest = round2(fm.amount - allocated);
  const updated = s.foundMoney.map((f): FoundMoney =>
    f.id === id ? { ...f, status: allocated > 0 ? 'allocated' : 'kept', allocations: [...allocations], amount: allocated > 0 ? allocated : f.amount } : f,
  );
  return {
    goals: creditAll(s.goals, allocations.map((a) => ({ ...a, source: fm.headline })), env),
    foundMoney: rest > 0 && allocated > 0 ? [...updated, { ...fm, id: idFor(env, 99), amount: rest, status: 'kept', headline: `${fm.headline} (kept for spending)` }] : updated,
  };
}

/** Deleting a goal returns what was allocated to it to the inbox. */
export function deleteGoal(s: MoneyPatch, goalId: string, env: Env): MoneyPatch {
  const foundMoney = s.foundMoney.flatMap((item, i): FoundMoney[] => {
    const removed = item.allocations?.filter((a) => a.goalId === goalId) ?? [];
    if (!removed.length) return [item];
    const remaining = item.allocations?.filter((a) => a.goalId !== goalId) ?? [];
    if (!remaining.length) return [{ ...item, status: 'pending', allocations: undefined }];
    return [
      { ...item, amount: sum(remaining.map((a) => a.amount)), allocations: remaining },
      { ...item, id: idFor(env, i), amount: sum(removed.map((a) => a.amount)), status: 'pending', allocations: undefined, auto: false, headline: `${item.headline} (returned)` },
    ];
  });
  return { goals: s.goals.filter((g) => g.id !== goalId), foundMoney };
}

// ---------------------------------------------------------------------------
// Time-driven triggers (each: Env → State → State, so they compose with pipe)

/**
 * Week rollover: compare last week's plan with actual food spend.
 * Under plan → Found Money. More than 10% over → next week is budget-light.
 */
export const weekRollover = (env: Env) => (s: AppData): AppData => {
  const ws = weekStart(env.today);
  if (!s.plan) return { ...s, plan: planWeek(s, env), groceryChecked: [] };
  if (s.plan.weekStart >= ws) return s;
  const estimate = planCost(s.plan.days, s.profile.householdSize, s.pantry.map((p) => p.key), s.profile.currency) * planCoverage(s.plan);
  const actual = planWeekFoodSpend(s.transactions, s.plan);
  const weekHistory = [...s.weekHistory.filter((w) => w.weekStart !== s.plan!.weekStart), { weekStart: s.plan.weekStart, estimate, actual }];
  const saved = Math.round(estimate - actual);
  const money1 =
    actual > 0 && actual <= estimate && saved > 0
      ? addFoundMoney(
          s,
          {
            amount: saved,
            headline: `You saved ${money(saved, s.profile.currency)} on food last week`,
            source: `Groceries and eating out came in ${money(saved, s.profile.currency)} under your plan.`,
            kind: 'grocery_underspend',
          },
          scopeEnv(env, 'week'),
        )
      : { foundMoney: s.foundMoney, goals: s.goals };
  const mode: MealPlan['mode'] = actual > estimate * 1.1 ? 'budget_light' : 'normal';
  const next = { ...s, ...money1, weekHistory };
  return { ...next, plan: planWeek(next, env, { mode, weekStart: ws }), groceryChecked: [] };
};

/** Fixed payday sweeps, once per pay cycle. */
export const paydaySweep = (env: Env) => (s: AppData): AppData => {
  const payday = s.income?.payday ?? 25;
  const thisPayday = `${env.today.slice(0, 8)}${String(payday).padStart(2, '0')}`;
  if (env.today < thisPayday || (s.lastPaydayProcessed ?? '') >= thisPayday) return s;
  const credits = s.goals.flatMap((g) => g.rules.filter((r) => r.kind === 'fixed' && r.enabled && r.amount).map((r) => ({ goalId: g.id, amount: r.amount!, source: 'Payday sweep' })));
  return { ...s, goals: creditAll(s.goals, credits, scopeEnv(env, 'payday')), lastPaydayProcessed: thisPayday };
};

/** Month-end threshold rule: if last month ended with more than X unassigned, ask the user. */
export const monthEndCheck = (env: Env) => (s: AppData): AppData => {
  const ms = monthStart(env.today);
  if ((s.lastMonthProcessed ?? ms) >= ms) return s;
  const prevStart = monthStart(addDays(ms, -1));
  const unallocated = flexibleMonthly(s.income, s.bills, s.goals) - spend(s.transactions, prevStart, ms);
  const triggers = s.goals.flatMap((g) => g.rules.filter((r) => r.kind === 'threshold' && r.enabled && r.amount && unallocated > r.amount));
  const money2 = triggers.reduce<MoneyPatch>(
    (acc, _r, i) =>
      addFoundMoney(
        acc,
        {
          amount: Math.round(unallocated),
          headline: `${monthName(prevStart)} ended with ${money(unallocated, s.profile.currency)} unassigned`,
          source: 'Your threshold rule asked us to check with you.',
          kind: 'unallocated',
        },
        scopeEnv(env, `month${i}`),
      ),
    { foundMoney: s.foundMoney, goals: s.goals },
  );
  return { ...s, ...money2, lastMonthProcessed: ms };
};

/** All time-driven rules, in order. Not onboarded → unchanged. */
export const syncTime = (s: AppData, env: Env): AppData => (s.onboarded ? pipe(s, weekRollover(env), paydaySweep(env), monthEndCheck(env)) : s);
