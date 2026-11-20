/**
 * Actionable insights engine (spec §3.4). Rule-based and data-anchored: every
 * insight carries an amount, one action and a destination goal, and is ranked by
 * (money at stake × actionability) ÷ effort. Copy never shames.
 *
 * Insights are grouped: 'fixed' covers recurring obligations (subscriptions,
 * bill increases, the fixed-cost ratio); 'habit' covers everyday spending.
 */
import { addDays, DAY_LONG, monthStart, today, weekStart } from '@/lib/dates';
import { money, PRICE_FACTOR } from '@/lib/format';
import { allSwapKeys, servingCost } from '@/lib/mealPlanner';
import { categoryAverages, discretionaryTransactions, monthlyIncome, riskyDays, spend, weeklyFlexible } from '@/lib/budget';
import { fixedCostRatio, FREQUENCY_SHORT, isSubscription, monthlyAmount, recurringCreep } from '@/lib/recurring';
import { MEAL_SLOTS, type Currency, type Goal, type Income, type MealPlan, type RecurringExpense, type Transaction } from '@/store/types';

export type Insight = {
  id: string;
  type: 'subscription' | 'creep' | 'fixed_costs' | 'dining' | 'grocery' | 'waste' | 'reallocation';
  /** 'fixed' = recurring obligations, 'habit' = everyday spending. */
  group: 'fixed' | 'habit';
  icon: string;
  headline: string;
  detail: string;
  amountMonthly: number;
  amountLabel: string;
  action: { label: string; kind: 'cancel' | 'plan' | 'swap' | 'assign' | 'review'; expenseId?: string; amount?: number };
  destinationGoalId: string | null;
  score: number;
};

export type InsightInput = {
  recurringExpenses: RecurringExpense[];
  transactions: Transaction[];
  goals: Goal[];
  plan: MealPlan | null;
  income: Income | null;
  weeklyFoodBudget: number;
  householdSize: number;
  currency: Currency;
  dismissed: string[];
  assignedWeeks: string[];
};

const MIN_MONTHLY_ZAR = 50;
const MIN_CREEP_ZAR = 10;
/** Housing + transport above this share of take-home gets a gentle heads-up. */
const FIXED_COST_GUIDE = 0.5;

export function generateInsights(s: InsightInput): Insight[] {
  const c = s.currency;
  const fmt = (n: number) => money(n, c);
  const dest = s.goals.find((g) => g.type === 'emergency') ?? s.goals[0];
  const destName = dest?.name ?? 'your safety net';
  const out: Insight[] = [];
  const t = today();

  // a. Subscriptions with low usage (optional recurring expenses)
  s.recurringExpenses
    .filter((e) => e.active && isSubscription(e))
    .forEach((e) => {
      const monthly = monthlyAmount(e);
      const yearly = monthly * 12;
      const lowUse = !!e.usageNote;
      out.push({
        id: `sub-${e.id}`,
        type: 'subscription',
        group: 'fixed',
        icon: 'repeat-outline',
        headline: `Free up ${fmt(yearly)} a year from ${e.name}`,
        detail: lowUse
          ? `You've paid ${fmt(monthly)}/mo for ${e.monthsPaid ?? 'several'} months and ${e.usageNote}. Cancelling sends ${fmt(yearly)}/yr to ${destName}.`
          : `${e.name} costs ${fmt(monthly)}/mo. If you rarely use it, cancelling sends ${fmt(yearly)}/yr to ${destName}.`,
        amountMonthly: monthly,
        amountLabel: `${fmt(monthly)}/mo`,
        action: { label: 'Mark as cancelled', kind: 'cancel', expenseId: e.id, amount: monthly },
        destinationGoalId: dest?.id ?? null,
        score: (monthly * (lowUse ? 0.9 : 0.4)) / 1,
      });
    });

  // a2. Recurring bills that went up (creep)
  recurringCreep(s.recurringExpenses, s.transactions, MIN_CREEP_ZAR * PRICE_FACTOR[c]).forEach((creep) => {
    const e = creep.expense;
    const optional = isSubscription(e);
    out.push({
      id: `creep-${e.id}-${Math.round(creep.to)}`,
      type: 'creep',
      group: 'fixed',
      icon: 'trending-up-outline',
      headline: `${e.name} went up ${fmt(creep.to - creep.from)}`,
      detail: `It was ${fmt(creep.from)}/${FREQUENCY_SHORT[e.frequency]}${creep.since ? ` in ${creep.since.slice(0, 7)}` : ''} and is now ${fmt(creep.to)}. ${
        optional ? 'Check whether a cheaper plan still covers what you use.' : 'A quick call or a comparison quote can often bring it back down.'
      } Anything you save can go to ${destName}.`,
      amountMonthly: creep.monthlyIncrease,
      amountLabel: `+${fmt(creep.monthlyIncrease)}/mo`,
      action: { label: 'Review bill', kind: 'review', expenseId: e.id },
      destinationGoalId: dest?.id ?? null,
      score: (creep.monthlyIncrease * (optional ? 0.7 : 0.6)) / 1.5,
    });
  });

  // a3. Fixed-cost ratio: housing + transport share of take-home
  const income = monthlyIncome(s.income);
  const ratio = fixedCostRatio(s.recurringExpenses, income);
  if (ratio && ratio.ratio > FIXED_COST_GUIDE) {
    const above = ratio.total - income * FIXED_COST_GUIDE;
    const pct = Math.round(ratio.ratio * 100);
    out.push({
      id: `fixed-ratio-${Math.round(ratio.ratio * 20)}`,
      type: 'fixed_costs',
      group: 'fixed',
      icon: 'home-outline',
      headline: `Housing and transport take ${pct}% of your take-home`,
      detail: `That's ${fmt(ratio.housing)} housing and ${fmt(ratio.transport)} transport a month. A common guide is about half, so this is worth keeping in mind when a lease renews or your commute changes. Each ${fmt(500 * PRICE_FACTOR[c])} less a month is ${fmt(6000 * PRICE_FACTOR[c])} a year for ${destName}.`,
      amountMonthly: above,
      amountLabel: `${pct}%`,
      action: { label: 'Review bills', kind: 'review' },
      destinationGoalId: dest?.id ?? null,
      // Big money, but slow to change: low actionability, high effort.
      score: (above * 0.15) / 3,
    });
  }

  // b. Eating out vs the user's own baseline, plus risky-day pattern
  // Habits only: payments of saved recurring expenses are obligations, not habits.
  const habits = discretionaryTransactions(s.transactions, s.recurringExpenses);
  const avgs = categoryAverages(habits);
  const norm = avgs.food_dining ?? 0;
  const ms = monthStart(t);
  const dayOfMonth = Number(t.slice(8, 10));
  const diningMtd = spend(habits, ms, addDays(t, 1), ['food_dining']);
  const pace = dayOfMonth >= 7 ? (diningMtd / dayOfMonth) * 30 : norm;
  const diningTx = habits.filter((x) => x.category === 'food_dining' && x.date >= addDays(t, -56));
  const avgTicket = diningTx.length ? diningTx.reduce((a, b) => a + b.amount, 0) / diningTx.length : 0;
  const homeDinner = s.plan ? servingCost(s.plan.days[0].slots.dinner.recipeId, [], c) * s.householdSize : 40 * PRICE_FACTOR[c];
  const perDinner = Math.max(0, avgTicket - homeDinner);
  const risky = riskyDays(habits, 50 * PRICE_FACTOR[c]).filter((d) => d.risky).sort((a, b) => b.avg - a.avg)[0];
  if (perDinner > 0 && (pace > norm * 1.1 || risky)) {
    const weekly = perDinner * 2;
    out.push({
      id: `dining-${weekStart(t)}`,
      type: 'dining',
      group: 'habit',
      icon: 'restaurant-outline',
      headline: `Two home-cooked dinners ≈ ${fmt(weekly)} back`,
      detail: risky
        ? `${DAY_LONG[risky.day]}s average ${fmt(risky.avg)} on takeaways. Plan dinner that night and most of it goes to ${destName}.`
        : `Eating out is on pace for ${fmt(pace)} this month vs your usual ${fmt(norm)}. Cooking twice more this week frees ${fmt(weekly)}.`,
      amountMonthly: weekly * (52 / 12),
      amountLabel: `${fmt(weekly)}/wk`,
      action: { label: 'Plan dinners', kind: 'plan' },
      destinationGoalId: dest?.id ?? null,
      score: (weekly * 4.3 * 0.7) / 1.5,
    });
  }

  // c. Grocery composition: brand premium from receipts, else unused swaps in the plan
  const recent = s.transactions.filter((x) => x.lineItems && x.date >= addDays(t, -30));
  const branded = recent.flatMap((x) => x.lineItems!.filter((i) => i.brand && i.storeBrandPrice));
  if (branded.length) {
    const premium = branded.reduce((a, i) => a + (i.price - (i.storeBrandPrice ?? i.price)), 0) / recent.length;
    const total = recent.reduce((a, x) => a + x.amount, 0) / recent.length;
    const share = total > 0 ? branded.reduce((a, i) => a + i.price, 0) / recent.length / total : 0;
    const weekly = premium * 2;
    out.push({
      id: `brand-${recent.length}`,
      type: 'grocery',
      group: 'habit',
      icon: 'pricetags-outline',
      headline: `Store brands on ${branded.length} staples ≈ ${fmt(weekly)}/wk`,
      detail: `Brand items are ${Math.round(share * 100)}% of your basket. Switching those staples keeps the same meals and sends ${fmt(weekly * 4.3)}/mo to ${destName}.`,
      amountMonthly: weekly * 4.3,
      amountLabel: `${fmt(weekly)}/wk`,
      action: { label: 'Apply swaps', kind: 'swap' },
      destinationGoalId: dest?.id ?? null,
      score: (weekly * 4.3 * 0.8) / 1.2,
    });
  } else if (s.plan) {
    let saving = 0;
    let count = 0;
    s.plan.days.forEach((d) =>
      MEAL_SLOTS.forEach((slot) => {
        const m = d.slots[slot];
        const keys = allSwapKeys(m.recipeId).filter((k) => !m.swaps.includes(k));
        if (keys.length && m.leftoverOf === undefined) {
          saving += (servingCost(m.recipeId, m.swaps, c) - servingCost(m.recipeId, [...m.swaps, ...keys], c)) * s.householdSize;
          count++;
        }
      }),
    );
    if (saving > 0) {
      out.push({
        id: `swaps-${s.plan.weekStart}`,
        type: 'grocery',
        group: 'habit',
        icon: 'swap-horizontal-outline',
        headline: `Cheaper swaps save ≈ ${fmt(saving)} this week`,
        detail: `${count} meals have store-brand or frozen swaps that keep the same dish. Apply them and the difference goes to ${destName}.`,
        amountMonthly: saving * 4.3,
        amountLabel: `${fmt(saving)}/wk`,
        action: { label: 'Apply swaps', kind: 'swap' },
        destinationGoalId: dest?.id ?? null,
        score: (saving * 4.3 * 0.8) / 1.2,
      });
    }
  }

  // Waste: perishables bought repeatedly
  const perishables = new Map<string, number>();
  recent.forEach((x) => x.lineItems!.filter((i) => i.perishable && /coriander|herb|parsley|basil/i.test(i.name)).forEach((i) => perishables.set(i.name, (perishables.get(i.name) ?? 0) + i.price)));
  perishables.forEach((spent, name) => {
    const times = recent.filter((x) => x.lineItems!.some((i) => i.name === name)).length;
    if (times >= 3) {
      out.push({
        id: `waste-${name}`,
        type: 'waste',
        group: 'habit',
        icon: 'leaf-outline',
        headline: `Use up ${name.toLowerCase()} with your plan`,
        detail: `You bought ${name.toLowerCase()} ${times}× this month. Your plan now uses one bunch across several meals — about ${fmt(spent / 2)} back.`,
        amountMonthly: spent / 2,
        amountLabel: `${fmt(spent / 2)}/mo`,
        action: { label: 'See plan', kind: 'plan' },
        destinationGoalId: dest?.id ?? null,
        score: (spent / 2) * 0.6,
      });
    }
  });

  // d. Unallocated flexible money this week
  const ws = weekStart(t);
  if (s.income && !s.assignedWeeks.includes(ws)) {
    const flex = weeklyFlexible(s.income, s.recurringExpenses, s.goals);
    const otherWeekly = ((avgs.food_dining ?? 0) + (avgs.transport ?? 0) + (avgs.shopping ?? 0) + (avgs.entertainment ?? 0) + (avgs.health ?? 0) + (avgs.household ?? 0) + (avgs.other ?? 0)) / 4.3;
    const food = s.weeklyFoodBudget;
    const unallocated = Math.floor((flex - food - otherWeekly) / 10) * 10;
    if (unallocated >= MIN_MONTHLY_ZAR * PRICE_FACTOR[c]) {
      out.push({
        id: `realloc-${ws}`,
        type: 'reallocation',
        group: 'habit',
        icon: 'git-branch-outline',
        headline: `${fmt(unallocated)} is unassigned this week`,
        detail: `After bills, food and your usual spending, ${fmt(unallocated)} has no job yet. Give it one — ${destName} is a good home.`,
        amountMonthly: unallocated * 4.3,
        amountLabel: fmt(unallocated),
        action: { label: 'Assign it', kind: 'assign', amount: unallocated },
        destinationGoalId: dest?.id ?? null,
        score: (unallocated * 4.3 * 0.5) / 1,
      });
    }
  }

  return out
    .filter((i) => i.amountMonthly >= (i.type === 'creep' ? MIN_CREEP_ZAR : MIN_MONTHLY_ZAR) * PRICE_FACTOR[c] && !s.dismissed.includes(i.id))
    .sort((a, b) => b.score - a.score);
}
