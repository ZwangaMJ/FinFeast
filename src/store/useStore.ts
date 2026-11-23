/**
 * The imperative shell: zustand state plus thin actions. Each action reads the
 * outside world once (`systemEnv()`), calls pure engines/rules, and `set`s the result.
 */
import { create } from 'zustand';

import { RECIPES } from '@/data/recipes';
import { splitRecurringSuggestions } from '@/lib/bankStatement';
import { setUserMeals } from '@/lib/catalog';
import { monthStart, weekStart } from '@/lib/dates';
import { scopeEnv } from '@/lib/env';
import { money } from '@/lib/format';
import type { Insight } from '@/lib/insights';
import { planOrFallback, regenerateDay, regenerateSlot, relinkBatches, withAllSwaps } from '@/lib/mealPlanner';
import type { ExtractionResult } from '@/lib/parser';
import { monthlyAmount } from '@/lib/recurring';
import {
  addFoundMoney,
  allocateFoundMoney,
  applyRoundUps,
  creditGoal,
  deleteGoal,
  ensureEmergencyGoal,
  plannerBase,
  planDayIndex,
  planWeek,
  syncTime as runTimeRules,
  type FoundMoneyInput,
} from './rules';
import * as food from './food';
import type { GroceryInput, MealInput } from './food';
import { systemEnv, uid } from './systemEnv';
import { MEAL_SLOTS, type AppData, type Category, type DocRecord, type FoodImageRef, type FoundMoney, type Goal, type MealPlan, type MealSlot, type Profile, type RecurringExpense, type Rule, type Settings, type Transaction } from './types';

export { uid };
export type { AppData };

export type ReviewEdits = {
  net?: number;
  rejectedRecurringIds?: string[];
  /** Category / essential changes made to detected recurring expenses during review. */
  recurringEdits?: Record<string, Partial<Pick<RecurringExpense, 'category' | 'isEssential'>>>;
  /** Saved recurring expense id → the newer amount seen on the statement. */
  recurringAmountUpdates?: Record<string, number>;
  weeklyFood?: number;
  savingsMonthly?: number;
  receiptCategory?: Category;
  receiptTotal?: number;
  answers?: Record<string, Category>;
};

export type RecurringExpenseInput = Omit<RecurringExpense, 'id' | 'active'> & { active?: boolean };

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

  /** Creates a custom meal; returns its recipe id. */
  createMeal: (input: MealInput) => string;
  /** Edits a custom meal or saves the user's copy of a built-in. Returns false if the recipe doesn't exist. */
  updateRecipe: (recipeId: string, input: MealInput) => boolean;
  /** Deletes a custom meal or hides a built-in, replacing it wherever it is planned. */
  deleteRecipe: (recipeId: string) => void;
  /** Reverts a built-in to the original (drops the user's edits or un-hides it). */
  restoreRecipe: (recipeId: string) => void;
  setMealImage: (mealId: string, image: FoodImageRef | null) => void;
  createGroceryItem: (input: GroceryInput) => string;
  updateGroceryItem: (id: string, patch: Partial<GroceryInput>) => void;
  deleteGroceryItem: (id: string) => void;
  toggleGroceryItem: (id: string) => void;
  setGroceryImage: (id: string, image: FoodImageRef | null) => void;

  addGoal: (g: Omit<Goal, 'id' | 'contributions' | 'createdAt' | 'current'> & { current?: number }) => string;
  updateGoal: (id: string, g: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  contribute: (goalId: string, amount: number, source: string) => void;
  upsertRule: (goalId: string, rule: Rule) => void;
  removeRule: (goalId: string, ruleId: string) => void;

  addFoundMoney: (fm: Omit<FoundMoney, 'id' | 'createdAt' | 'status'>) => void;
  allocateFoundMoney: (id: string, allocations: { goalId: string; amount: number }[]) => void;
  keepFoundMoney: (id: string) => void;
  addRecurringExpense: (e: RecurringExpenseInput) => string;
  updateRecurringExpense: (id: string, patch: Partial<Omit<RecurringExpense, 'id'>>) => void;
  removeRecurringExpense: (id: string) => void;
  cancelRecurringExpense: (id: string) => void;
  toggleRecurringExpense: (id: string) => void;
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
  weeklyFoodBudget: 0,
  recurringExpenses: [],
  transactions: [],
  documents: [],
  plan: null,
  pendingPlan: null,
  pendingReason: null,
  pantry: [],
  groceryChecked: [],
  meals: [],
  groceries: [],
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

export const useStore = create<AppData & Actions>()((set, get) => {
      const data = (): AppData => getAppData(get());
      const ensureEmergency = (s: Pick<AppData, 'recurringExpenses' | 'weeklyFoodBudget' | 'goals'>) => ensureEmergencyGoal(s, systemEnv());
      const foundMoney = (input: FoundMoneyInput) => set((s) => addFoundMoney(s, input, systemEnv()));

      return {
        ...initialData,

        setProfile: (p) => {
          set((s) => ({ profile: { ...s.profile, ...p } }));
          const planning: (keyof Profile)[] = ['diet', 'allergies', 'householdSize', 'calorieTarget', 'maxCookMinutes', 'currency'];
          if (get().plan && planning.some((k) => k in p)) get().regenerateWeek(get().plan!.mode);
        },
        setSettings: (st) => set((s) => ({ settings: { ...s.settings, ...st } })),

        completeOnboarding: () => {
          const month = monthStart(systemEnv().today);
          set((s) => ({ onboarded: true, goals: ensureEmergency(s), lastMonthProcessed: month, lastPaydayProcessed: month }));
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
            const rejected = edits.rejectedRecurringIds ?? [];
            const reviewed = r.recurringExpenses
              .filter((e) => !rejected.includes(e.id))
              .map((e) => ({ ...e, ...(edits.recurringEdits?.[e.id] ?? {}) }));
            // Re-check against what is saved now: the list may have changed since the review opened.
            const { fresh } = splitRecurringSuggestions(reviewed, s.recurringExpenses);
            const amountUpdates = edits.recurringAmountUpdates ?? {};
            const answers = edits.answers ?? {};
            const tx = r.transactions.map((t) => (answers[t.id] ? { ...t, category: answers[t.id], confidence: 'high' as const, question: undefined } : t));
            next = {
              ...next,
              recurringExpenses: [
                ...s.recurringExpenses.map((e) => (amountUpdates[e.id] > 0 ? { ...e, amount: amountUpdates[e.id] } : e)),
                ...fresh,
              ],
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
            next.goals = applyRoundUps([t], s.goals, systemEnv());
          }
          if (r.taxForm) next.taxInfo = r.taxForm;
          set(next);
          if (doc.type === 'payslip') set((st) => ({ goals: ensureEmergency(st), manualMode: st.recurringExpenses.length === 0 ? st.manualMode : false }));
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
          const env = systemEnv();
          set((s) => ({ transactions: [tx, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date)), goals: applyRoundUps([tx], s.goals, env) }));
        },

        ensurePlan: () => {
          const s = data();
          if (!s.plan) set({ plan: planWeek(s, systemEnv()), groceryChecked: [] });
        },

        regenerateWeek: (mode = 'normal') => {
          const s = data();
          set({ plan: planWeek(s, systemEnv(), { mode, weekStart: s.plan?.weekStart }) ?? s.plan, groceryChecked: [], pendingPlan: null, pendingReason: null });
        },

        regenerateMeal: (day, slot) => {
          const s = data();
          if (!s.plan) return;
          const env = systemEnv();
          const next = planOrFallback(regenerateSlot(s.plan, plannerBase(s, s.plan.mode), day, slot, { seed: env.seed, generatedAt: env.now }));
          if (next) set({ plan: next });
        },

        regenerateDay: (day) => {
          const s = data();
          if (!s.plan) return;
          const env = systemEnv();
          const next = planOrFallback(regenerateDay(s.plan, plannerBase(s, s.plan.mode), day, { seed: env.seed, generatedAt: env.now }));
          if (next) set({ plan: next });
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
          if (s.plan) set({ plan: withAllSwaps(s.plan) });
        },

        proposeLighterPlan: (reason) => {
          const s = data();
          if (!s.plan) return;
          const env = systemEnv();
          const proposed = planWeek(s, env, { mode: 'budget_light', weekStart: s.plan.weekStart, lockedFrom: s.plan, lockBeforeDay: planDayIndex(s.plan, env) });
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

        togglePantry: (key) => {
          const addedAt = systemEnv().today;
          set((s) => ({ pantry: s.pantry.some((p) => p.key === key) ? s.pantry.filter((p) => p.key !== key) : [...s.pantry, { key, addedAt }] }));
        },
        toggleGrocery: (id) => set((s) => ({ groceryChecked: s.groceryChecked.includes(id) ? s.groceryChecked.filter((x) => x !== id) : [...s.groceryChecked, id] })),
        clearGroceryChecks: () => set((s) => ({ groceryChecked: [], groceries: s.groceries.some((g) => g.checked) ? s.groceries.map((g) => (g.checked ? { ...g, checked: false } : g)) : s.groceries })),

        createMeal: (input) => {
          const { meals, recipeId } = food.createMeal(get().meals, input, systemEnv());
          set({ meals });
          return recipeId;
        },
        updateRecipe: (recipeId, input) => {
          const result = food.editRecipe(get().meals, recipeId, input, systemEnv());
          if (!result) return false;
          set({ meals: result.meals });
          return true;
        },
        deleteRecipe: (recipeId) => {
          const env = systemEnv();
          const s0 = get();
          set({ meals: food.deleteRecipe(s0.meals, recipeId, env, s0.profile.currency), groceries: food.dropMealGroceries(s0.groceries, recipeId) });
          // The registry now excludes the recipe; replace it wherever it is planned.
          const s = data();
          if (!s.plan) return;
          let plan: MealPlan = { ...s.plan, days: s.plan.days.map((d) => ({ ...d, snacks: d.snacks.filter((id) => id !== recipeId) })) };
          const base = plannerBase(s, s.plan.mode);
          s.plan.days.forEach((d, day) =>
            MEAL_SLOTS.forEach((slot) => {
              if (d.slots[slot].recipeId === recipeId) plan = planOrFallback(regenerateSlot(plan, base, day, slot, { seed: env.seed + day, generatedAt: env.now })) ?? plan;
            }),
          );
          set({ plan });
        },
        restoreRecipe: (recipeId) => set((s) => ({ meals: food.restoreBuiltIn(s.meals, recipeId) })),
        setMealImage: (mealId, image) => set((s) => ({ meals: food.setMealImage(s.meals, mealId, image, systemEnv()) })),

        createGroceryItem: (input) => {
          const { groceries, item } = food.createGroceryItem(get().groceries, input, systemEnv());
          set({ groceries });
          return item.id;
        },
        updateGroceryItem: (id, patch) => set((s) => ({ groceries: food.updateGroceryItem(s.groceries, id, patch, systemEnv()) })),
        deleteGroceryItem: (id) => set((s) => ({ groceries: food.deleteGroceryItem(s.groceries, id) })),
        toggleGroceryItem: (id) => set((s) => ({ groceries: food.toggleGroceryItem(s.groceries, id, systemEnv()) })),
        setGroceryImage: (id, image) => set((s) => ({ groceries: food.setGroceryImage(s.groceries, id, image, systemEnv()) })),

        addGoal: (g) => {
          const id = uid();
          const createdAt = systemEnv().today;
          set((s) => ({ goals: [...s.goals, { ...g, current: g.current ?? 0, id, contributions: [], createdAt }] }));
          return id;
        },
        updateGoal: (id, g) => set((s) => ({ goals: s.goals.map((x) => (x.id === id ? { ...x, ...g } : x)) })),
        deleteGoal: (id) => {
          const env = systemEnv();
          set((s) => deleteGoal(s, id, env));
        },
        contribute: (goalId, amount, source) => {
          const env = systemEnv();
          set((s) => ({ goals: creditGoal(s.goals, goalId, amount, source, env) }));
        },
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

        addFoundMoney: foundMoney,
        allocateFoundMoney: (id, allocations) => {
          const env = systemEnv();
          set((s) => allocateFoundMoney(s, id, allocations, env));
        },
        keepFoundMoney: (id) => set((s) => ({ foundMoney: s.foundMoney.map((f) => (f.id === id ? { ...f, status: 'kept' } : f)) })),

        addRecurringExpense: (input) => {
          const id = uid();
          set((s) => {
            const recurringExpenses = [...s.recurringExpenses, { ...input, id, active: input.active ?? true }];
            return { recurringExpenses, goals: s.onboarded ? ensureEmergency({ ...s, recurringExpenses }) : s.goals };
          });
          return id;
        },
        updateRecurringExpense: (id, patch) =>
          set((s) => {
            const recurringExpenses = s.recurringExpenses.map((e) => (e.id === id ? { ...e, ...patch, id } : e));
            return { recurringExpenses, goals: s.onboarded ? ensureEmergency({ ...s, recurringExpenses }) : s.goals };
          }),
        removeRecurringExpense: (id) =>
          set((s) => {
            const recurringExpenses = s.recurringExpenses.filter((e) => e.id !== id);
            return { recurringExpenses, goals: s.onboarded ? ensureEmergency({ ...s, recurringExpenses }) : s.goals };
          }),
        cancelRecurringExpense: (id) => {
          const s = get();
          const expense = s.recurringExpenses.find((e) => e.id === id);
          if (!expense || !expense.active) return;
          set({ recurringExpenses: s.recurringExpenses.map((e) => (e.id === id ? { ...e, active: false } : e)) });
          const monthly = Math.round(monthlyAmount(expense) * 100) / 100;
          foundMoney({
            amount: monthly,
            headline: `${money(monthly, s.profile.currency)}/mo freed from ${expense.name}`,
            source: `You cancelled ${expense.name} — that's ${money(monthly * 12, s.profile.currency)} a year back.`,
            kind: 'subscription',
          });
        },
        toggleRecurringExpense: (id) => set((s) => ({ recurringExpenses: s.recurringExpenses.map((e) => (e.id === id ? { ...e, active: !e.active } : e)) })),

        dismissInsight: (id) => set((s) => ({ dismissedInsights: [...s.dismissedInsights, id] })),
        actOnInsight: (i) => {
          if (i.action.kind === 'cancel' && i.action.expenseId) get().cancelRecurringExpense(i.action.expenseId);
          if (i.action.kind === 'swap') get().applyAllSwaps();
          if (i.action.kind === 'assign' && i.action.amount) {
            const s = get();
            const week = weekStart(systemEnv().today);
            set({ assignedWeeks: [...s.assignedWeeks, week] });
            foundMoney({
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
          const before = data();
          const after = runTimeRules(before, scopeEnv(systemEnv(), 'sync'));
          if (after !== before) set(after);
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
    recurringExpenses: state.recurringExpenses,
    transactions: state.transactions,
    documents: state.documents,
    plan: state.plan,
    pendingPlan: state.pendingPlan,
    pendingReason: state.pendingReason,
    pantry: state.pantry,
    groceryChecked: state.groceryChecked,
    meals: state.meals,
    groceries: state.groceries,
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

// Keep the catalogue registry (src/lib/catalog.ts) in step with the user's meals, so the planner
// and every recipe lookup see custom, edited and hidden meals. Listeners run synchronously after set().
setUserMeals(useStore.getState().meals);
useStore.subscribe((state) => setUserMeals(state.meals));
