/**
 * Actionable insights & nudges engine (spec §3.4). Rule-based and data-anchored:
 * every insight carries an amount, one action and a destination goal, and is
 * ranked by (money at stake × actionability) ÷ effort. Copy never shames.
 *
 * Structure: build one read-only context → run independent detectors → score →
 * drop below threshold → drop dismissed → rank. All pure; `asOf` supplies the date.
 */
import { addDays, DAY_LONG, monthStart, weekStart } from '@/lib/dates';
import { categoryAverages, riskyDays, spend, spendVelocity, weeklyFlexible, type RiskyDay, type SpendVelocity } from '@/lib/budget';
import { filterBy, mapBy, mean, pipe, round2, sortBy, sum, type DeepReadonly } from '@/lib/fp';
import { money, PRICE_FACTOR } from '@/lib/format';
import { dayNutrition, planCost, PROTEIN_FLOOR_G, servingCost, withAllSwaps } from '@/lib/mealPlanner';
import type { Bill, Category, Currency, Goal, Income, MealPlan, Transaction } from '@/store/types';

export type Insight = Readonly<{
  id: string;
  type: 'subscription' | 'dining' | 'grocery' | 'waste' | 'reallocation' | 'velocity';
  icon: string;
  headline: string;
  detail: string;
  amountMonthly: number;
  amountLabel: string;
  action: Readonly<{ label: string; kind: 'cancel' | 'plan' | 'swap' | 'assign'; billId?: string; amount?: number }>;
  destinationGoalId: string | null;
  score: number;
}>;

export type InsightInput = DeepReadonly<{
  bills: Bill[];
  transactions: Transaction[];
  goals: Goal[];
  plan: MealPlan | null;
  income: Income | null;
  weeklyFoodBudget: number;
  householdSize: number;
  currency: Currency;
  dismissed: string[];
  assignedWeeks: string[];
  asOf: string;
}>;

const MIN_MONTHLY_ZAR = 50;

/** A detector's finding before ranking: how actionable it is and how much effort it takes. */
type Candidate = Omit<Insight, 'score'> & Readonly<{ actionability: number; effort: number }>;

type Ctx = Readonly<{
  input: InsightInput;
  fmt: (n: number) => string;
  dest: DeepReadonly<Goal> | undefined;
  destName: string;
  averages: Readonly<Partial<Record<Category, number>>>;
  risky: readonly RiskyDay[];
  velocity: SpendVelocity;
  threshold: number;
}>;

// ---------------------------------------------------------------------------
// Context

function buildContext(input: InsightInput): Ctx {
  const dest = input.goals.find((g) => g.type === 'emergency') ?? input.goals[0];
  return {
    input,
    fmt: (n) => money(n, input.currency),
    dest,
    destName: dest?.name ?? 'your safety net',
    averages: categoryAverages(input.transactions, input.asOf),
    risky: riskyDays({ transactions: input.transactions, asOf: input.asOf, plan: input.plan, bills: input.bills, minAmount: MIN_MONTHLY_ZAR * PRICE_FACTOR[input.currency] }),
    velocity: spendVelocity({ transactions: input.transactions, bills: input.bills, asOf: input.asOf, minExcess: MIN_MONTHLY_ZAR * PRICE_FACTOR[input.currency] }),
    threshold: MIN_MONTHLY_ZAR * PRICE_FACTOR[input.currency],
  };
}

const destinationOf = (ctx: Ctx) => ctx.dest?.id ?? null;

// ---------------------------------------------------------------------------
// Detectors: (ctx) → candidates. Each is independent and side-effect free.

type Detector = (ctx: Ctx) => readonly Candidate[];

/** a. Subscriptions, especially low-usage ones. */
const subscriptions: Detector = (ctx) =>
  ctx.input.bills
    .filter((b) => b.active && b.isSubscription)
    .map((b) => {
      const yearly = b.amount * 12;
      const lowUse = !!b.usageNote;
      return {
        id: `sub-${b.id}`,
        type: 'subscription',
        icon: 'repeat-outline',
        headline: `Free up ${ctx.fmt(yearly)} a year from ${b.name}`,
        detail: lowUse
          ? `You've paid ${ctx.fmt(b.amount)}/mo for ${b.monthsPaid ?? 'several'} months and ${b.usageNote}. Cancelling sends ${ctx.fmt(yearly)}/yr to ${ctx.destName}.`
          : `${b.name} costs ${ctx.fmt(b.amount)}/mo. If you rarely use it, cancelling sends ${ctx.fmt(yearly)}/yr to ${ctx.destName}.`,
        amountMonthly: b.amount,
        amountLabel: `${ctx.fmt(b.amount)}/mo`,
        action: { label: 'Mark as cancelled', kind: 'cancel', billId: b.id, amount: b.amount },
        destinationGoalId: destinationOf(ctx),
        actionability: lowUse ? 0.9 : 0.4,
        effort: 1,
      };
    });

/** Spend velocity: discretionary spending speeding up ahead of a known bill. */
const velocity: Detector = (ctx) => {
  const v = ctx.velocity;
  const bill = v.upcomingBills.find((b) => b.excessBeforeDue >= ctx.threshold);
  if (!v.alert || !bill || v.acceleration === null) return [];
  const when = bill.daysUntil === 0 ? 'today' : bill.daysUntil === 1 ? 'tomorrow' : `in ${bill.daysUntil} days`;
  return [
    {
      id: `velocity-${bill.billId}-${bill.dueDate}`,
      type: 'velocity',
      icon: 'speedometer-outline',
      headline: `Ease the pace before ${bill.name} — keep ${ctx.fmt(bill.excessBeforeDue)}`,
      detail: `Day-to-day spending is running ${Math.round((v.acceleration - 1) * 100)}% above your usual pace, and ${bill.name} (${ctx.fmt(bill.amount)}) is due ${when}. Back at your usual pace, ${ctx.fmt(bill.excessBeforeDue)} stays ready for it.`,
      amountMonthly: bill.excessBeforeDue,
      amountLabel: ctx.fmt(bill.excessBeforeDue),
      action: { label: 'Plan the next few days', kind: 'plan' },
      destinationGoalId: destinationOf(ctx),
      actionability: 0.6,
      effort: 1,
    },
  ];
};

/** b. Eating out vs the user's own baseline, plus the highest Risky Day Score. */
const dining: Detector = (ctx) => {
  const { input } = ctx;
  const t = input.asOf;
  const c = input.currency;
  const norm = ctx.averages.food_dining ?? 0;
  const dayOfMonth = Number(t.slice(8, 10));
  const diningMtd = spend(input.transactions, monthStart(t), addDays(t, 1), ['food_dining']);
  const pace = dayOfMonth >= 7 ? (diningMtd / dayOfMonth) * 30 : norm;
  const tickets = input.transactions.filter((x) => x.category === 'food_dining' && x.kind === 'expense' && x.date >= addDays(t, -56)).map((x) => x.amount);
  const avgTicket = mean(tickets);
  const homeDinner = input.plan ? servingCost(input.plan.days[0].slots.dinner.recipeId, [], c) * input.householdSize : 40 * PRICE_FACTOR[c];
  const perDinner = Math.max(0, avgTicket - homeDinner);
  const risky = pipe(ctx.risky, filterBy((d: RiskyDay) => d.risky), sortBy((a: RiskyDay, b: RiskyDay) => b.score - a.score || b.avg - a.avg))[0];
  if (perDinner <= 0 || !(pace > norm * 1.1 || risky)) return [];
  const weekly = perDinner * 2;
  return [
    {
      id: `dining-${weekStart(t)}`,
      type: 'dining',
      icon: 'restaurant-outline',
      headline: `Two home-cooked dinners ≈ ${ctx.fmt(weekly)} back`,
      detail: risky
        ? `${DAY_LONG[risky.day]}s average ${ctx.fmt(risky.avg)} on takeaways. Plan dinner that night and most of it goes to ${ctx.destName}.`
        : `Eating out is on pace for ${ctx.fmt(pace)} this month vs your usual ${ctx.fmt(norm)}. Cooking twice more this week frees ${ctx.fmt(weekly)}.`,
      amountMonthly: weekly * (52 / 12),
      amountLabel: `${ctx.fmt(weekly)}/wk`,
      action: { label: 'Plan dinners', kind: 'plan' },
      destinationGoalId: destinationOf(ctx),
      actionability: 0.7,
      effort: 1.5,
    },
  ];
};

const recentReceipts = (ctx: Ctx) => ctx.input.transactions.filter((x) => x.lineItems && x.date >= addDays(ctx.input.asOf, -30));

/** c. Grocery composition: brand premium from receipts, else unused swaps in the plan. */
const grocery: Detector = (ctx) => {
  const recent = recentReceipts(ctx);
  const branded = recent.flatMap((x) => (x.lineItems ?? []).filter((i) => i.brand && i.storeBrandPrice));
  if (branded.length) {
    const premium = sum(branded.map((i) => i.price - (i.storeBrandPrice ?? i.price))) / recent.length;
    const basket = sum(recent.map((x) => x.amount)) / recent.length;
    const share = basket > 0 ? sum(branded.map((i) => i.price)) / recent.length / basket : 0;
    const weekly = premium * 2;
    return [
      {
        id: `brand-${recent.length}`,
        type: 'grocery',
        icon: 'pricetags-outline',
        headline: `Store brands on ${branded.length} staples ≈ ${ctx.fmt(weekly)}/wk`,
        detail: `Brand items are ${Math.round(share * 100)}% of your basket. Switching those staples keeps the same meals and sends ${ctx.fmt(weekly * 4.3)}/mo to ${ctx.destName}.`,
        amountMonthly: weekly * 4.3,
        amountLabel: `${ctx.fmt(weekly)}/wk`,
        action: { label: 'Apply swaps', kind: 'swap' },
        destinationGoalId: destinationOf(ctx),
        actionability: 0.8,
        effort: 1.2,
      },
    ];
  }
  const plan = ctx.input.plan;
  if (!plan) return [];
  const surplus = calculateMealSwapSurplus(plan, withAllSwaps(plan), {
    householdSize: ctx.input.householdSize,
    pantry: [],
    currency: ctx.input.currency,
    calorieTarget: 0,
  });
  if (surplus.weeklySurplus <= 0) return [];
  return [
    {
      id: `swaps-${plan.weekStart}`,
      type: 'grocery',
      icon: 'swap-horizontal-outline',
      headline: `Cheaper swaps save ≈ ${ctx.fmt(surplus.weeklySurplus)} this week`,
      detail: `${surplus.mealsChanged} meals have store-brand or frozen swaps that keep the same dish. Apply them and the difference goes to ${ctx.destName}.`,
      amountMonthly: surplus.monthlySurplus,
      amountLabel: `${ctx.fmt(surplus.weeklySurplus)}/wk`,
      action: { label: 'Apply swaps', kind: 'swap' },
      destinationGoalId: destinationOf(ctx),
      actionability: 0.8,
      effort: 1.2,
    },
  ];
};

/** Waste: the same perishable herb bought three or more times in a month. */
const waste: Detector = (ctx) => {
  const recent = recentReceipts(ctx);
  const herbs = recent.flatMap((x) => (x.lineItems ?? []).filter((i) => i.perishable && /coriander|herb|parsley|basil/i.test(i.name)));
  const names = [...new Set(herbs.map((i) => i.name))];
  return names.flatMap((name): Candidate[] => {
    const times = recent.filter((x) => (x.lineItems ?? []).some((i) => i.name === name)).length;
    const back = sum(herbs.filter((i) => i.name === name).map((i) => i.price)) / 2;
    if (times < 3) return [];
    return [
      {
        id: `waste-${name}`,
        type: 'waste',
        icon: 'leaf-outline',
        headline: `Use up ${name.toLowerCase()} with your plan`,
        detail: `You bought ${name.toLowerCase()} ${times}× this month. Your plan now uses one bunch across several meals — about ${ctx.fmt(back)} back.`,
        amountMonthly: back,
        amountLabel: `${ctx.fmt(back)}/mo`,
        action: { label: 'See plan', kind: 'plan' },
        destinationGoalId: destinationOf(ctx),
        actionability: 0.6,
        effort: 1,
      },
    ];
  });
};

/** d. Flexible money this week with no job yet. */
const reallocation: Detector = (ctx) => {
  const { input, averages: a } = ctx;
  const ws = weekStart(input.asOf);
  if (!input.income || input.assignedWeeks.includes(ws)) return [];
  const flex = weeklyFlexible(input.income, input.bills, input.goals);
  const otherWeekly = ((a.food_dining ?? 0) + (a.transport ?? 0) + (a.shopping ?? 0) + (a.entertainment ?? 0) + (a.health ?? 0) + (a.household ?? 0) + (a.other ?? 0)) / 4.3;
  const unallocated = Math.floor((flex - input.weeklyFoodBudget - otherWeekly) / 10) * 10;
  if (unallocated < ctx.threshold) return [];
  return [
    {
      id: `realloc-${ws}`,
      type: 'reallocation',
      icon: 'git-branch-outline',
      headline: `${ctx.fmt(unallocated)} is unassigned this week`,
      detail: `After bills, food and your usual spending, ${ctx.fmt(unallocated)} has no job yet. Give it one — ${ctx.destName} is a good home.`,
      amountMonthly: unallocated * 4.3,
      amountLabel: ctx.fmt(unallocated),
      action: { label: 'Assign it', kind: 'assign', amount: unallocated },
      destinationGoalId: destinationOf(ctx),
      actionability: 0.5,
      effort: 1,
    },
  ];
};

export const DETECTORS: readonly Detector[] = [subscriptions, velocity, dining, grocery, waste, reallocation];

// ---------------------------------------------------------------------------
// Ranking pipeline

/** (money at stake × actionability) ÷ effort. */
export const priorityScore = (c: Readonly<{ amountMonthly: number; actionability: number; effort: number }>) => (c.amountMonthly * c.actionability) / c.effort;

const toInsight = ({ actionability, effort, ...rest }: Candidate): Insight => ({ ...rest, score: priorityScore({ amountMonthly: rest.amountMonthly, actionability, effort }) });

export function generateInsights(input: InsightInput, detectors: readonly Detector[] = DETECTORS): readonly Insight[] {
  const ctx = buildContext(input);
  return pipe(
    detectors.flatMap((detect) => detect(ctx)),
    mapBy(toInsight),
    filterBy((i: Insight) => i.amountMonthly >= ctx.threshold),
    filterBy((i: Insight) => !input.dismissed.includes(i.id)),
    sortBy((a: Insight, b: Insight) => b.score - a.score || a.id.localeCompare(b.id)),
  );
}

// ---------------------------------------------------------------------------
// Frugality nudges: trade-off calculators

export type SwapSurplusContext = Readonly<{ householdSize: number; pantry: readonly string[]; currency: Currency; calorieTarget: number }>;

export type MealSwapSurplus = Readonly<{
  /** Grocery bill saved per week by switching to the frugal alternative (negative = it costs more). */
  weeklySurplus: number;
  monthlySurplus: number;
  mealsChanged: number;
  perDay: readonly Readonly<{ date: string; kcalDelta: number; proteinDelta: number }>[];
  /** False if the alternative drops any day below the protein floor or, when a target is given, 10% under calories. */
  nutritionFloorRespected: boolean;
  /** Worth suggesting: saves money without breaking the nutrition floor. */
  worthIt: boolean;
}>;

/**
 * What switching from `currentPlan` to `frugalAlternative` frees up, and what it
 * costs nutritionally. Uses the consolidated grocery list (whole packs), so the
 * surplus is what actually leaves the user's wallet.
 */
export function calculateMealSwapSurplus(
  currentPlan: DeepReadonly<MealPlan>,
  frugalAlternative: DeepReadonly<MealPlan>,
  ctx: SwapSurplusContext,
): MealSwapSurplus {
  const cost = (p: DeepReadonly<MealPlan>) => planCost(p.days, ctx.householdSize, ctx.pantry, ctx.currency);
  const weeklySurplus = round2(cost(currentPlan) - cost(frugalAlternative));
  const slotsOf = (p: DeepReadonly<MealPlan>) => p.days.flatMap((d) => [d.slots.breakfast, d.slots.lunch, d.slots.dinner].map((m) => `${m.recipeId}|${[...m.swaps].sort().join(',')}`));
  const before = slotsOf(currentPlan);
  const mealsChanged = slotsOf(frugalAlternative).filter((s, i) => s !== before[i]).length;
  const perDay = frugalAlternative.days.map((d, i) => {
    const a = dayNutrition(d);
    const b = currentPlan.days[i] ? dayNutrition(currentPlan.days[i]) : a;
    return { date: d.date, kcalDelta: a.kcal - b.kcal, proteinDelta: a.protein - b.protein, kcal: a.kcal, protein: a.protein };
  });
  const nutritionFloorRespected = perDay.every((d) => d.protein >= PROTEIN_FLOOR_G && (ctx.calorieTarget <= 0 || d.kcal >= ctx.calorieTarget * 0.9));
  return {
    weeklySurplus,
    monthlySurplus: round2(weeklySurplus * (52 / 12)),
    mealsChanged,
    perDay: perDay.map(({ date, kcalDelta, proteinDelta }) => ({ date, kcalDelta, proteinDelta })),
    nutritionFloorRespected,
    worthIt: weeklySurplus > 0 && nutritionFloorRespected,
  };
}
