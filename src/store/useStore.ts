import { create } from 'zustand';

import { RECIPES } from '@/data/recipes';
import { emergencyTarget, flexibleMonthly, planCoverage, planWeekFoodSpend, spend } from '@/lib/budget';
import { addDays, daysBetween, monthName, monthStart, today, weekStart } from '@/lib/dates';
import { money, PRICE_FACTOR } from '@/lib/format';
import type { Insight } from '@/lib/insights';
import { allSwapKeys, generatePlan, planCost, regenerateDay, regenerateSlot, relinkBatches, type PlannerInput } from '@/lib/mealPlanner';
import type { ExtractionResult } from '@/lib/parser';
import {
  MEAL_SLOTS,
  type Bill,
  type Category,
  type DocRecord,
  type FoundMoney,
  type Goal,
  type Income,
  type MealPlan,
  type MealSlot,
  type PantryItem,
  type Profile,
  type Rule,
  type Settings,
  type Transaction,
  type WeekRecord,
} from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export type AppData = {
  onboarded: boolean;
  profile: Profile;
  settings: Settings;
  manualMode: boolean;
  income: Income | null;
  weeklyFoodBudget: number;
  bills: Bill[];
  transactions: Transaction[];
  documents: DocRecord[];
  plan: MealPlan | null;
  pendingPlan: MealPlan | null;
  pendingReason: string | null;
  pantry: PantryItem[];
  groceryChecked: string[];
  tried: string[];
  goals: Goal[];
  foundMoney: FoundMoney[];
  weekHistory: WeekRecord[];
  dismissedInsights: string[];
  assignedWeeks: string[];
  lastMonthProcessed: string | null;
  lastPaydayProcessed: string | null;
  taxInfo: { annualIncome: number; retirement: number } | null;
};

export type ReviewEdits = {
  net?: number;
  rejectedBillIds?: string[];
  weeklyFood?: number;
  savingsMonthly?: number;
  receiptCategory?: Category;
  receiptTotal?: number;
  answers?: Record<string, Category>;
};

type Actions = {
  setProfile: (p: Partial<Profile>) => void;
  setSettings: (s: Partial<Settings>) => void;
  completeOnboarding: () => void;
  setManualBaseline: (net: number, weeklyFood: number) => void;
  setWeeklyFoodBudget: (n: number) => void;
  applyExtraction: (doc: DocRecord, result: ExtractionResult, edits: ReviewEdits) => void;
  addFailedDocument: (doc: DocRecord) => void;
  removeDocument: (id: string) => void;
  recategorize: (txId: string, category: Category) => void;
  addManualTransaction: (t: Omit<Transaction, 'id' | 'confidence'>) => void;

  ensurePlan: () => void;
  regenerateWeek: (mode?: MealPlan['mode']) => void;
  regenerateMeal: (day: number, slot: MealSlot) => void;
  regenerateDay: (day: number) => void;
  toggleSwap: (day: number, slot: MealSlot, key: string) => void;
  applyAllSwaps: () => void;
  proposeLighterPlan: (reason: string) => void;
  acceptPendingPlan: () => void;
  dismissPendingPlan: () => void;
  markCooked: (day: number, slot: MealSlot, cooked: boolean) => void;
  togglePantry: (key: string) => void;
  toggleGrocery: (id: string) => void;
  clearGroceryChecks: () => void;

  addGoal: (g: Omit<Goal, 'id' | 'contributions' | 'createdAt' | 'current'> & { current?: number }) => string;
  updateGoal: (id: string, g: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  contribute: (goalId: string, amount: number, source: string) => void;
  upsertRule: (goalId: string, rule: Rule) => void;
  removeRule: (goalId: string, ruleId: string) => void;

  addFoundMoney: (fm: Omit<FoundMoney, 'id' | 'createdAt' | 'status'>) => void;
  allocateFoundMoney: (id: string, allocations: { goalId: string; amount: number }[]) => void;
  keepFoundMoney: (id: string) => void;
  cancelBill: (billId: string) => void;
  toggleBill: (billId: string) => void;
  dismissInsight: (id: string) => void;
  actOnInsight: (i: Insight) => void;

  syncTime: () => void;
  resetAll: () => void;
};

const defaultProfile: Profile = {
  name: '',
  email: '',
  householdSize: 2,
  currency: 'ZAR',
  diet: 'omnivore',
  allergies: [],
  calorieTarget: 2000,
  maxCookMinutes: 45,
  goalPriority: 'safety',
};

export const initialData: AppData = {
  onboarded: false,
  profile: defaultProfile,
  settings: { themeMode: 'system', notifications: false, riskAlerts: true, weeklyDigest: true },
  manualMode: false,
  income: null,
  weeklyFoodBudget: 700,
  bills: [],
  transactions: [],
  documents: [],
  plan: null,
  pendingPlan: null,
  pendingReason: null,
  pantry: [],
  groceryChecked: [],
  tried: RECIPES.filter((r) => r.classic).map((r) => r.id),
  goals: [],
  foundMoney: [],
  weekHistory: [],
  dismissedInsights: [],
  assignedWeeks: [],
  lastMonthProcessed: null,
  lastPaydayProcessed: null,
  taxInfo: null,
};

function plannerInput(s: AppData, mode: MealPlan['mode'] = 'normal'): Omit<PlannerInput, 'weekStart' | 'seed'> {
  return {
    profile: s.profile,
    ceiling: s.weeklyFoodBudget,
    pantry: s.pantry.map((p) => p.key),
    tried: s.tried,
    mode,
  };
}

const FOOD_CATS: Category[] = ['food_grocery', 'food_dining'];

export const useStore = create<AppData & Actions>()((set, get) => {
      /** Route found money through the user's opt-in rules; unruled money waits in the inbox. */
      const routeFoundMoney = (fm: FoundMoney, goals: Goal[]): { fm: FoundMoney[]; goals: Goal[] } => {
        const date = today();
        const credit = (gs: Goal[], goalId: string, amount: number, source: string) =>
          gs.map((g) => (g.id === goalId ? { ...g, current: g.current + amount, contributions: [{ id: uid(), date, amount, source }, ...g.contributions] } : g));

        if (fm.kind === 'grocery_underspend') {
          const target = goals.find((g) => g.rules.some((r) => r.kind === 'meal_surplus' && r.enabled));
          if (target) {
            return {
              fm: [{ ...fm, status: 'allocated', auto: true, allocations: [{ goalId: target.id, amount: fm.amount }] }],
              goals: credit(goals, target.id, fm.amount, 'Meal-plan surplus sweep'),
            };
          }
        }
        const pct = goals.flatMap((g) => g.rules.filter((r) => r.kind === 'percent' && r.enabled && r.percent).map((r) => ({ goalId: g.id, percent: r.percent! })));
        if (pct.length) {
          const total = Math.min(100, pct.reduce((a, p) => a + p.percent, 0));
          let gs = goals;
          const allocations = pct.map((p) => ({ goalId: p.goalId, amount: Math.round((fm.amount * p.percent) / 100) }));
          allocations.forEach((a) => (gs = credit(gs, a.goalId, a.amount, 'Found Money split rule')));
          const out: FoundMoney[] = [{ ...fm, amount: allocations.reduce((a, b) => a + b.amount, 0), status: 'allocated', auto: true, allocations }];
          const rest = Math.round(fm.amount * (1 - total / 100));
          if (rest > 0) out.push({ ...fm, id: uid(), amount: rest, headline: `${fm.headline} (remainder)` });
          return { fm: out, goals: gs };
        }
        return { fm: [fm], goals };
      };

      const roundUps = (txs: Transaction[], goals: Goal[]) => {
        let gs = goals;
        goals.forEach((g) =>
          g.rules
            .filter((r) => r.kind === 'roundup' && r.enabled)
            .forEach((r) => {
              const step = r.amount || 10;
              const total = txs.filter((t) => t.kind === 'expense' && FOOD_CATS.includes(t.category)).reduce((a, t) => a + (Math.ceil(t.amount / step) * step - t.amount), 0);
              if (total > 0) {
                const amt = Math.round(total * 100) / 100;
                gs = gs.map((x) => (x.id === g.id ? { ...x, current: x.current + amt, contributions: [{ id: uid(), date: today(), amount: amt, source: 'Food round-ups' }, ...x.contributions] } : x));
              }
            }),
        );
        return gs;
      };

      const ensureEmergency = (s: AppData): Goal[] => {
        const target = emergencyTarget(s.bills, s.weeklyFoodBudget);
        const existing = s.goals.find((g) => g.type === 'emergency');
        if (existing) {
          return s.goals.map((g) => (g.id === existing.id && g.contributions.length === 0 && g.current === 0 ? { ...g, target: Math.max(target, 1000) } : g));
        }
        return [
          {
            id: uid(),
            type: 'emergency',
            name: 'Emergency Fund',
            target: Math.max(target, 1000 * PRICE_FACTOR[s.profile.currency]),
            current: 0,
            deadline: null,
            monthlyCommitted: 0,
            rules: [{ id: uid(), kind: 'meal_surplus', enabled: true }],
            contributions: [],
            createdAt: today(),
          },
          ...s.goals,
        ];
      };

      return {
        ...initialData,

        setProfile: (p) => {
          set((s) => ({ profile: { ...s.profile, ...p } }));
          const planning: (keyof Profile)[] = ['diet', 'allergies', 'householdSize', 'calorieTarget', 'maxCookMinutes', 'currency'];
          if (get().plan && planning.some((k) => k in p)) get().regenerateWeek(get().plan!.mode);
        },
        setSettings: (st) => set((s) => ({ settings: { ...s.settings, ...st } })),

        completeOnboarding: () => {
          set((s) => ({ onboarded: true, goals: ensureEmergency(s), lastMonthProcessed: monthStart(), lastPaydayProcessed: monthStart() }));
          get().ensurePlan();
        },

        setManualBaseline: (net, weeklyFood) => {
          set((s) => ({
            manualMode: true,
            income: { net, gross: null, frequency: 'monthly', employer: null, payday: 25, source: 'manual' },
            weeklyFoodBudget: weeklyFood,
            goals: ensureEmergency({ ...s, weeklyFoodBudget: weeklyFood }),
          }));
          if (get().plan) get().regenerateWeek();
        },

        setWeeklyFoodBudget: (n) => {
          set({ weeklyFoodBudget: n });
          if (get().plan) get().regenerateWeek(get().plan!.mode);
        },

        applyExtraction: (doc, r, edits) => {
          const s = get();
          let next: Partial<AppData> = { documents: [{ ...doc, status: 'confirmed' }, ...s.documents.filter((d) => d.id !== doc.id)] };
          if (r.income?.net) {
            const net = edits.net ?? r.payslipSummary?.disposableNetIncome ?? r.income.net.value;
            if (doc.type === 'payslip' || !s.income || s.income.source === 'manual') {
              next.income = {
                net,
                gross: r.payslipSummary?.grossEarnings ?? r.income.gross?.value ?? s.income?.gross ?? null,
                frequency: r.income.frequency ?? 'monthly',
                employer: r.payslipSummary?.employer ?? r.income.employer ?? s.income?.employer ?? null,
                payday: 25,
                source: 'document',
              };
            }
          }
          if (r.documentType === 'bank_statement') {
            const rejected = edits.rejectedBillIds ?? [];
            const bills = r.recurringBills.filter((b) => !rejected.includes(b.id));
            const known = new Set(s.bills.map((b) => b.name.toLowerCase()));
            const answers = edits.answers ?? {};
            const tx = r.transactions.map((t) => (answers[t.id] ? { ...t, category: answers[t.id], confidence: 'high' as const, question: undefined } : t));
            next = {
              ...next,
              bills: [...s.bills, ...bills.filter((b) => !known.has(b.name.toLowerCase()))],
              transactions: [...tx, ...s.transactions.filter((t) => t.sourceDocId !== doc.id)].sort((a, b) => b.date.localeCompare(a.date)),
              weeklyFoodBudget: edits.weeklyFood ?? s.weeklyFoodBudget,
              manualMode: false,
            };
            const savings = edits.savingsMonthly ?? r.savingsTransfers.reduce((a, t) => a + t.monthly, 0);
            set(next);
            const goals = ensureEmergency(get()).map((g) => (g.type === 'emergency' && savings > 0 && g.monthlyCommitted === 0 ? { ...g, monthlyCommitted: savings } : g));
            set({ goals });
            if (s.plan) get().regenerateWeek(s.plan.mode);
            return;
          }
          if (r.receipt) {
            const t: Transaction = {
              id: uid(),
              date: r.receipt.date,
              merchant: r.receipt.merchant,
              amount: edits.receiptTotal ?? r.receipt.total,
              kind: 'expense',
              category: edits.receiptCategory ?? r.receipt.categoryGuess,
              confidence: 'high',
              sourceDocId: doc.id,
              lineItems: r.receipt.lineItems,
            };
            next.transactions = [t, ...s.transactions];
            next.goals = roundUps([t], s.goals);
          }
          if (r.taxForm) next.taxInfo = r.taxForm;
          set(next);
          if (doc.type === 'payslip') set((st) => ({ goals: ensureEmergency(st), manualMode: st.bills.length === 0 ? st.manualMode : false }));
        },

        addFailedDocument: (doc) => set((s) => ({ documents: [{ ...doc, status: 'failed' }, ...s.documents.filter((d) => d.id !== doc.id)] })),
        removeDocument: (id) =>
          set((s) => ({
            documents: s.documents.filter((d) => d.id !== id),
            transactions: s.transactions.map((transaction) => (transaction.sourceDocId === id ? { ...transaction, sourceDocId: undefined } : transaction)),
          })),

        recategorize: (txId, category) =>
          set((s) => ({ transactions: s.transactions.map((t) => (t.id === txId ? { ...t, category, confidence: 'high', question: undefined } : t)) })),

        addManualTransaction: (t) => {
          const tx: Transaction = { ...t, id: uid(), confidence: 'high' };
          set((s) => ({ transactions: [tx, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date)), goals: roundUps([tx], s.goals) }));
        },

        ensurePlan: () => {
          const s = get();
          if (!s.plan) {
            set({ plan: generatePlan({ ...plannerInput(s), weekStart: weekStart(), seed: Date.now() % 100000 }), groceryChecked: [] });
          }
        },

        regenerateWeek: (mode = 'normal') => {
          const s = get();
          set({ plan: generatePlan({ ...plannerInput(s, mode), weekStart: s.plan?.weekStart ?? weekStart(), seed: Date.now() % 100000 }), groceryChecked: [], pendingPlan: null, pendingReason: null });
        },

        regenerateMeal: (day, slot) => {
          const s = get();
          if (!s.plan) return;
          set({ plan: regenerateSlot(s.plan, plannerInput(s, s.plan.mode), day, slot) });
        },

        regenerateDay: (day) => {
          const s = get();
          if (!s.plan) return;
          set({ plan: regenerateDay(s.plan, plannerInput(s, s.plan.mode), day) });
        },

        toggleSwap: (day, slot, key) => {
          const s = get();
          if (!s.plan) return;
          const days = s.plan.days.map((d, i) => {
            if (i !== day && !(slot === 'dinner' && d.slots.lunch.leftoverOf === day && i === day + 1)) return d;
            const target: MealSlot = i === day ? slot : 'lunch';
            const m = d.slots[target];
            const swaps = m.swaps.includes(key) ? m.swaps.filter((k) => k !== key) : [...m.swaps, key];
            return { ...d, slots: { ...d.slots, [target]: { ...m, swaps } } };
          });
          set({ plan: { ...s.plan, days } });
        },

        applyAllSwaps: () => {
          const s = get();
          if (!s.plan) return;
          const days = s.plan.days.map((d) => ({
            ...d,
            slots: Object.fromEntries(MEAL_SLOTS.map((slot) => [slot, { ...d.slots[slot], swaps: allSwapKeys(d.slots[slot].recipeId) }])) as typeof d.slots,
          }));
          set({ plan: { ...s.plan, days } });
        },

        proposeLighterPlan: (reason) => {
          const s = get();
          if (!s.plan) return;
          const todayIdx = Math.max(0, Math.min(7, daysBetween(s.plan.weekStart, today())));
          const plan = s.plan;
          const proposed = generatePlan({
            ...plannerInput(s, 'budget_light'),
            weekStart: plan.weekStart,
            seed: plan.seed + 13,
            locked: (d, slot) => (d < todayIdx ? plan.days[d].slots[slot] : undefined),
          });
          set({ pendingPlan: proposed, pendingReason: reason });
        },
        acceptPendingPlan: () => set((s) => ({ plan: s.pendingPlan ?? s.plan, pendingPlan: null, pendingReason: null, groceryChecked: [] })),
        dismissPendingPlan: () => set({ pendingPlan: null, pendingReason: null }),

        markCooked: (day, slot, cooked) => {
          const s = get();
          if (!s.plan) return;
          const days = s.plan.days.map((d, i) => (i === day ? { ...d, slots: { ...d.slots, [slot]: { ...d.slots[slot], cooked } } } : d));
          const rid = s.plan.days[day].slots[slot].recipeId;
          set({ plan: { ...s.plan, days: relinkBatches(days) }, tried: cooked && !s.tried.includes(rid) ? [...s.tried, rid] : s.tried });
        },

        togglePantry: (key) =>
          set((s) => ({ pantry: s.pantry.some((p) => p.key === key) ? s.pantry.filter((p) => p.key !== key) : [...s.pantry, { key, addedAt: today() }] })),
        toggleGrocery: (id) => set((s) => ({ groceryChecked: s.groceryChecked.includes(id) ? s.groceryChecked.filter((x) => x !== id) : [...s.groceryChecked, id] })),
        clearGroceryChecks: () => set({ groceryChecked: [] }),

        addGoal: (g) => {
          const id = uid();
          set((s) => ({ goals: [...s.goals, { ...g, current: g.current ?? 0, id, contributions: [], createdAt: today() }] }));
          return id;
        },
        updateGoal: (id, g) => set((s) => ({ goals: s.goals.map((x) => (x.id === id ? { ...x, ...g } : x)) })),
        deleteGoal: (id) =>
          set((s) => {
            const foundMoney = s.foundMoney.flatMap((item) => {
              const removedAllocations = item.allocations?.filter((allocation) => allocation.goalId === id) ?? [];
              if (!removedAllocations.length) return [item];
              const returned = removedAllocations.reduce((total, allocation) => total + allocation.amount, 0);
              const remaining = item.allocations?.filter((allocation) => allocation.goalId !== id) ?? [];
              const updated = remaining.length
                ? { ...item, amount: remaining.reduce((total, allocation) => total + allocation.amount, 0), allocations: remaining }
                : { ...item, status: 'pending' as const, allocations: undefined };
              return remaining.length
                ? [updated, { ...item, id: uid(), amount: returned, status: 'pending' as const, allocations: undefined, auto: false, headline: `${item.headline} (returned)` }]
                : [updated];
            });
            return { goals: s.goals.filter((goal) => goal.id !== id), foundMoney };
          }),
        contribute: (goalId, amount, source) =>
          set((s) => ({
            goals: s.goals.map((g) => (g.id === goalId ? { ...g, current: Math.max(0, g.current + amount), contributions: [{ id: uid(), date: today(), amount, source }, ...g.contributions] } : g)),
          })),
        upsertRule: (goalId, rule) =>
          set((s) => ({
            goals: s.goals.map((g) => {
              // Meal-surplus sweep can only route to one goal at a time
              const rules = rule.kind === 'meal_surplus' && rule.enabled && g.id !== goalId ? g.rules.filter((r) => r.kind !== 'meal_surplus') : g.rules;
              if (g.id !== goalId) return { ...g, rules };
              return { ...g, rules: rules.some((r) => r.id === rule.id) ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule] };
            }),
          })),
        removeRule: (goalId, ruleId) => set((s) => ({ goals: s.goals.map((g) => (g.id === goalId ? { ...g, rules: g.rules.filter((r) => r.id !== ruleId) } : g)) })),

        addFoundMoney: (input) => {
          const s = get();
          const fm: FoundMoney = { ...input, id: uid(), createdAt: today(), status: 'pending' };
          const routed = routeFoundMoney(fm, s.goals);
          set({ foundMoney: [...routed.fm, ...s.foundMoney], goals: routed.goals });
        },
        allocateFoundMoney: (id, allocations) => {
          const s = get();
          const fm = s.foundMoney.find((f) => f.id === id);
          if (!fm) return;
          let goals = s.goals;
          allocations.forEach((a) => {
            goals = goals.map((g) => (g.id === a.goalId ? { ...g, current: g.current + a.amount, contributions: [{ id: uid(), date: today(), amount: a.amount, source: fm.headline }, ...g.contributions] } : g));
          });
          const allocated = allocations.reduce((a, b) => a + b.amount, 0);
          const rest = Math.round((fm.amount - allocated) * 100) / 100;
          set({
            goals,
            foundMoney: s.foundMoney.map((f): FoundMoney => (f.id === id ? { ...f, status: allocated > 0 ? 'allocated' : 'kept', allocations, amount: allocated > 0 ? allocated : f.amount } : f)).concat(
              rest > 0 && allocated > 0 ? [{ ...fm, id: uid(), amount: rest, status: 'kept', headline: `${fm.headline} (kept for spending)` }] : [],
            ),
          });
        },
        keepFoundMoney: (id) => set((s) => ({ foundMoney: s.foundMoney.map((f) => (f.id === id ? { ...f, status: 'kept' } : f)) })),

        cancelBill: (billId) => {
          const s = get();
          const bill = s.bills.find((b) => b.id === billId);
          if (!bill) return;
          set({ bills: s.bills.map((b) => (b.id === billId ? { ...b, active: false } : b)) });
          get().addFoundMoney({
            amount: bill.amount,
            headline: `${money(bill.amount, s.profile.currency)}/mo freed from ${bill.name}`,
            source: `You cancelled ${bill.name} — that's ${money(bill.amount * 12, s.profile.currency)} a year back.`,
            kind: 'subscription',
          });
        },
        toggleBill: (billId) => set((s) => ({ bills: s.bills.map((b) => (b.id === billId ? { ...b, active: !b.active } : b)) })),

        dismissInsight: (id) => set((s) => ({ dismissedInsights: [...s.dismissedInsights, id] })),
        actOnInsight: (i) => {
          if (i.action.kind === 'cancel' && i.action.billId) get().cancelBill(i.action.billId);
          if (i.action.kind === 'swap') get().applyAllSwaps();
          if (i.action.kind === 'assign' && i.action.amount) {
            const s = get();
            set({ assignedWeeks: [...s.assignedWeeks, weekStart()] });
            get().addFoundMoney({
              amount: i.action.amount,
              headline: `${money(i.action.amount, s.profile.currency)} ready to assign`,
              source: 'Flexible money with no job yet this week.',
              kind: 'unallocated',
            });
          }
          if (i.action.kind !== 'plan') set((s) => ({ dismissedInsights: [...s.dismissedInsights, i.id] }));
        },

        /** Week rollover (plan vs actual → Found Money or lighter plan) and payday/month rules. */
        syncTime: () => {
          const s = get();
          if (!s.onboarded) return;
          const ws = weekStart();
          const c = s.profile.currency;
          if (s.plan && s.plan.weekStart < ws) {
            const estimate = planCost(s.plan.days, s.profile.householdSize, s.pantry.map((p) => p.key), c) * planCoverage(s.plan);
            const actual = planWeekFoodSpend(s.transactions, s.plan);
            set({ weekHistory: [...s.weekHistory.filter((w) => w.weekStart !== s.plan!.weekStart), { weekStart: s.plan.weekStart, estimate, actual }] });
            let mode: MealPlan['mode'] = 'normal';
            if (actual > 0 && actual <= estimate) {
              const saved = Math.round(estimate - actual);
              if (saved > 0)
                get().addFoundMoney({
                  amount: saved,
                  headline: `You saved ${money(saved, c)} on food last week`,
                  source: `Groceries and eating out came in ${money(saved, c)} under your plan.`,
                  kind: 'grocery_underspend',
                });
            } else if (actual > estimate * 1.1) {
              mode = 'budget_light';
            }
            set({ plan: generatePlan({ ...plannerInput(get(), mode), weekStart: ws, seed: Date.now() % 100000 }), groceryChecked: [] });
          } else if (!s.plan) {
            get().ensurePlan();
          }

          // Payday fixed sweeps
          const st = get();
          const payday = st.income?.payday ?? 25;
          const thisPayday = `${today().slice(0, 8)}${String(payday).padStart(2, '0')}`;
          if (today() >= thisPayday && (st.lastPaydayProcessed ?? '') < thisPayday) {
            let goals = st.goals;
            goals.forEach((g) =>
              g.rules
                .filter((r) => r.kind === 'fixed' && r.enabled && r.amount)
                .forEach((r) => {
                  goals = goals.map((x) => (x.id === g.id ? { ...x, current: x.current + r.amount!, contributions: [{ id: uid(), date: today(), amount: r.amount!, source: 'Payday sweep' }, ...x.contributions] } : x));
                }),
            );
            set({ goals, lastPaydayProcessed: thisPayday });
          }

          // Month-end threshold trigger ("ask me")
          const ms = monthStart();
          if ((st.lastMonthProcessed ?? ms) < ms) {
            const prevStart = monthStart(addDays(ms, -1));
            const unallocated = flexibleMonthly(st.income, st.bills, st.goals) - spend(st.transactions, prevStart, ms);
            st.goals.forEach((g) =>
              g.rules
                .filter((r) => r.kind === 'threshold' && r.enabled && r.amount && unallocated > r.amount)
                .forEach(() =>
                  get().addFoundMoney({
                    amount: Math.round(unallocated),
                    headline: `${monthName(prevStart)} ended with ${money(unallocated, c)} unassigned`,
                    source: 'Your threshold rule asked us to check with you.',
                    kind: 'unallocated',
                  }),
                ),
            );
            set({ lastMonthProcessed: ms });
          }
        },

        resetAll: () => set(initialData),
      };
    });

export function getAppData(state: AppData & Actions = useStore.getState()): AppData {
  return {
    onboarded: state.onboarded,
    profile: state.profile,
    settings: state.settings,
    manualMode: state.manualMode,
    income: state.income,
    weeklyFoodBudget: state.weeklyFoodBudget,
    bills: state.bills,
    transactions: state.transactions,
    documents: state.documents,
    plan: state.plan,
    pendingPlan: state.pendingPlan,
    pendingReason: state.pendingReason,
    pantry: state.pantry,
    groceryChecked: state.groceryChecked,
    tried: state.tried,
    goals: state.goals,
    foundMoney: state.foundMoney,
    weekHistory: state.weekHistory,
    dismissedInsights: state.dismissedInsights,
    assignedWeeks: state.assignedWeeks,
    lastMonthProcessed: state.lastMonthProcessed,
    lastPaydayProcessed: state.lastPaydayProcessed,
    taxInfo: state.taxInfo,
  };
}

export function exportData() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'FinFeast', data: getAppData() }, null, 2);
}
