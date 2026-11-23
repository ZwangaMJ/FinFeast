import type {
  Bill,
  DocRecord,
  FoundMoney,
  Goal,
  Income,
  MealPlan,
  PantryItem,
  Profile,
  Rule,
  Settings,
  Transaction,
  WeekRecord,
} from '@/store/types';
import { initialData, type AppData } from '@/store/useStore';
import { getSupabaseClient } from './client';
import { groceryFromRow, mealFromRow, type GroceryRow, type MealRow } from './foodRows';

type Row = Record<string, unknown>;
type Numeric = number | string;
type ProfileRow = Row & {
  name: string;
  household_size: number;
  currency: Profile['currency'];
  diet: Profile['diet'];
  allergies: Profile['allergies'];
  calorie_target: number;
  max_cook_minutes: number;
  goal_priority: Profile['goalPriority'];
  theme_mode: Settings['themeMode'];
  notifications: boolean;
  risk_alerts: boolean;
  weekly_digest: boolean;
  onboarded: boolean;
  manual_mode: boolean;
};
type FinanceRow = Row & {
  weekly_food_budget: Numeric;
  tax_info: AppData['taxInfo'] | null;
  last_month_processed: string | null;
  last_payday_processed: string | null;
};
type IncomeRow = Row & {
  net: Numeric;
  gross: Numeric | null;
  frequency: Income['frequency'];
  employer: string | null;
  payday: number;
  source: Income['source'];
};
type AppStateRow = Row & {
  tried_recipes: string[];
  grocery_checked: string[];
  dismissed_insights: string[];
  assigned_weeks: string[];
};
type BillRow = Row & {
  id: string;
  name: string;
  amount: Numeric;
  day: number;
  cadence: Bill['cadence'];
  confidence: Bill['confidence'];
  active: boolean;
  is_subscription: boolean;
  usage_note: string | null;
  months_paid: number | null;
};
type DocumentRow = Row & {
  id: string;
  name: string;
  type: DocRecord['type'];
  hash: string;
  added_at: string;
  status: DocRecord['status'];
  pages: number;
  summary: string;
};
type TransactionRow = Row & {
  id: string;
  transaction_date: string;
  merchant: string;
  amount: Numeric;
  kind: Transaction['kind'];
  category: Transaction['category'];
  confidence: Transaction['confidence'];
  question: string | null;
  alternatives: Transaction['category'][] | null;
  source_document_id: string | null;
  line_items: Transaction['lineItems'] | null;
};
type MealPlanRow = Row & { is_pending: boolean; pending_reason: string | null; plan: MealPlan };
type PantryRow = Row & { item_key: string; added_at: string };
type GoalRow = Row & {
  id: string;
  type: Goal['type'];
  name: string;
  target: Numeric;
  current: Numeric;
  deadline: string | null;
  monthly_committed: Numeric;
  created_at: string;
};
type RuleRow = Row & {
  id: string;
  goal_id: string;
  kind: Rule['kind'];
  amount: Numeric | null;
  percent: Numeric | null;
  enabled: boolean;
};
type ContributionRow = Row & { id: string; goal_id: string; contribution_date: string; amount: Numeric; source: string };
type FoundMoneyRow = Row & {
  id: string;
  amount: Numeric;
  headline: string;
  source: string;
  kind: FoundMoney['kind'];
  created_at: string;
  status: FoundMoney['status'];
  auto: boolean;
};
type AllocationRow = Row & { found_money_id: string; goal_id: string; amount: Numeric };
type WeekHistoryRow = Row & { week_start: string; estimate: Numeric; actual: Numeric };
type PageQuery = {
  range: (from: number, to: number) => PromiseLike<{
    data: Row[] | null;
    error: { message: string } | null;
    count: number | null;
  }>;
};

function assertNoError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

async function loadAllRows(query: PageQuery, operation: string): Promise<Row[]> {
  const pageSize = 500;
  const output: Row[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error, count } = await query.range(offset, offset + pageSize - 1);
    assertNoError(error, operation);
    if (count === null) throw new Error(`Supabase ${operation} returned no total row count.`);
    if (!data?.length && output.length < count) throw new Error(`Supabase ${operation} returned an incomplete result.`);
    if (data) output.push(...data);
    if (output.length >= count) return output;
  }
}

function amount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Supabase returned an invalid financial amount.');
  return parsed;
}

function rows<T extends Row>(value: T[] | null): T[] {
  return value ?? [];
}

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export const supabaseDataRepository = {
  async load(userId: string, email: string): Promise<AppData | null> {
    const client = getSupabaseClient();
    const results = await Promise.all([
      client.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
      client.from('user_finances').select('*').eq('user_id', userId).maybeSingle(),
      client.from('user_income').select('*').eq('user_id', userId).maybeSingle(),
      client.from('user_app_state').select('*').eq('user_id', userId).maybeSingle(),
      loadAllRows(client.from('bills').select('*', { count: 'exact' }).eq('user_id', userId), 'load bills'),
      loadAllRows(client.from('documents').select('*', { count: 'exact' }).eq('user_id', userId), 'load documents'),
      loadAllRows(client.from('transactions').select('*', { count: 'exact' }).eq('user_id', userId).order('transaction_date', { ascending: false }), 'load transactions'),
      loadAllRows(client.from('meal_plans').select('*', { count: 'exact' }).eq('user_id', userId), 'load meal plans'),
      loadAllRows(client.from('pantry_items').select('*', { count: 'exact' }).eq('user_id', userId), 'load pantry'),
      loadAllRows(client.from('goals').select('*', { count: 'exact' }).eq('user_id', userId), 'load goals'),
      loadAllRows(client.from('goal_rules').select('*', { count: 'exact' }).eq('user_id', userId), 'load goal rules'),
      loadAllRows(client.from('goal_contributions').select('*', { count: 'exact' }).eq('user_id', userId).order('contribution_date', { ascending: false }), 'load goal contributions'),
      loadAllRows(client.from('found_money').select('*', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }), 'load found money'),
      loadAllRows(client.from('found_money_allocations').select('*', { count: 'exact' }).eq('user_id', userId), 'load found money allocations'),
      loadAllRows(client.from('week_history').select('*', { count: 'exact' }).eq('user_id', userId).order('week_start', { ascending: false }), 'load week history'),
      loadAllRows(client.from('meals').select('*', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: true }), 'load meals'),
      loadAllRows(client.from('groceries').select('*', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: true }), 'load groceries'),
    ]);

    const [
      profileResult,
      financesResult,
      incomeResult,
      appStateResult,
      bills,
      documents,
      transactions,
      mealPlans,
      pantryItems,
      goalRows,
      rules,
      contributions,
      foundMoneyRows,
      allocations,
      weekHistoryRows,
      mealRows,
      groceryRows,
    ] = results;

    assertNoError(profileResult.error, 'load profile');
    assertNoError(financesResult.error, 'load finances');
    assertNoError(incomeResult.error, 'load income');
    assertNoError(appStateResult.error, 'load app state');

    const profile = profileResult.data as ProfileRow | null;
    if (!profile) return null;

    const finance = financesResult.data as FinanceRow | null;
    const storedIncome = incomeResult.data as IncomeRow | null;
    const appState = appStateResult.data as AppStateRow | null;
    const billsData: Bill[] = rows(bills as BillRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      amount: amount(row.amount),
      day: row.day,
      cadence: row.cadence,
      confidence: row.confidence,
      active: row.active,
      isSubscription: row.is_subscription,
      ...(row.usage_note ? { usageNote: row.usage_note } : {}),
      ...(row.months_paid === null ? {} : { monthsPaid: row.months_paid }),
    }));
    const documentsData: DocRecord[] = rows(documents as DocumentRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      hash: row.hash,
      addedAt: row.added_at,
      status: row.status,
      pages: row.pages,
      summary: row.summary,
    }));
    const transactionsData: Transaction[] = rows(transactions as TransactionRow[]).map((row) => ({
      id: row.id,
      date: row.transaction_date,
      merchant: row.merchant,
      amount: amount(row.amount),
      kind: row.kind,
      category: row.category,
      confidence: row.confidence,
      ...(row.question ? { question: row.question } : {}),
      alternatives: row.alternatives ?? [],
      ...(row.source_document_id ? { sourceDocId: row.source_document_id } : {}),
      ...(row.line_items ? { lineItems: row.line_items } : {}),
    }));

    const rulesByGoal = new Map<string, Rule[]>();
    rows(rules as RuleRow[]).forEach((row) => {
      const current = rulesByGoal.get(row.goal_id) ?? [];
      current.push({
        id: row.id,
        kind: row.kind,
        ...(row.amount === null ? {} : { amount: amount(row.amount) }),
        ...(row.percent === null ? {} : { percent: amount(row.percent) }),
        enabled: row.enabled,
      });
      rulesByGoal.set(row.goal_id, current);
    });

    const contributionsByGoal = new Map<string, Goal['contributions']>();
    rows(contributions as ContributionRow[]).forEach((row) => {
      const current = contributionsByGoal.get(row.goal_id) ?? [];
      current.push({ id: row.id, date: row.contribution_date, amount: amount(row.amount), source: row.source });
      contributionsByGoal.set(row.goal_id, current);
    });

    const goals: Goal[] = rows(goalRows as GoalRow[]).map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      target: amount(row.target),
      current: amount(row.current),
      deadline: dateOnly(row.deadline),
      monthlyCommitted: amount(row.monthly_committed),
      rules: rulesByGoal.get(row.id) ?? [],
      contributions: contributionsByGoal.get(row.id) ?? [],
      createdAt: dateOnly(row.created_at) ?? row.created_at,
    }));

    const allocationsByMoney = new Map<string, NonNullable<FoundMoney['allocations']>>();
    rows(allocations as AllocationRow[]).forEach((row) => {
      const current = allocationsByMoney.get(row.found_money_id) ?? [];
      current.push({ goalId: row.goal_id, amount: amount(row.amount) });
      allocationsByMoney.set(row.found_money_id, current);
    });

    const foundMoney: FoundMoney[] = rows(foundMoneyRows as FoundMoneyRow[]).map((row) => {
      const allocations = allocationsByMoney.get(row.id);
      return {
        id: row.id,
        amount: amount(row.amount),
        headline: row.headline,
        source: row.source,
        kind: row.kind,
        createdAt: dateOnly(row.created_at) ?? row.created_at,
        status: row.status === 'allocated' && !allocations?.length ? 'pending' : row.status,
        ...(allocations?.length ? { allocations } : {}),
        ...(row.auto ? { auto: true } : {}),
      };
    });

    const plans = rows(mealPlans as MealPlanRow[]);
    const currentPlan = plans.find((row: Row) => !row.is_pending);
    const pendingPlan = plans.find((row: Row) => row.is_pending);
    const profileData: Profile = {
      name: profile.name,
      email,
      householdSize: profile.household_size,
      currency: profile.currency,
      diet: profile.diet,
      allergies: profile.allergies ?? [],
      calorieTarget: profile.calorie_target,
      maxCookMinutes: profile.max_cook_minutes,
      goalPriority: profile.goal_priority,
    };
    const settings: Settings = {
      themeMode: profile.theme_mode,
      notifications: profile.notifications,
      riskAlerts: profile.risk_alerts,
      weeklyDigest: profile.weekly_digest,
    };
    const income: Income | null = storedIncome
      ? {
          net: amount(storedIncome.net),
          gross: storedIncome.gross === null ? null : amount(storedIncome.gross),
          frequency: storedIncome.frequency,
          employer: storedIncome.employer,
          payday: storedIncome.payday,
          source: storedIncome.source,
        }
      : null;
    const pantry: PantryItem[] = rows(pantryItems as PantryRow[]).map((row) => ({ key: row.item_key, addedAt: row.added_at }));
    const weekHistory: WeekRecord[] = rows(weekHistoryRows as WeekHistoryRow[]).map((row) => ({
      weekStart: row.week_start,
      estimate: amount(row.estimate),
      actual: amount(row.actual),
    }));

    return {
      ...initialData,
      onboarded: profile.onboarded,
      profile: profileData,
      settings,
      manualMode: profile.manual_mode,
      income,
      weeklyFoodBudget: finance ? amount(finance.weekly_food_budget) : initialData.weeklyFoodBudget,
      bills: billsData,
      transactions: transactionsData,
      documents: documentsData,
      plan: (currentPlan?.plan as MealPlan | undefined) ?? null,
      pendingPlan: (pendingPlan?.plan as MealPlan | undefined) ?? null,
      pendingReason: pendingPlan?.pending_reason ?? null,
      pantry,
      groceryChecked: appState?.grocery_checked ?? [],
      meals: rows(mealRows as unknown as (Row & MealRow)[]).map(mealFromRow),
      groceries: rows(groceryRows as unknown as (Row & GroceryRow)[]).map(groceryFromRow),
      tried: appState?.tried_recipes ?? initialData.tried,
      goals,
      foundMoney,
      weekHistory,
      dismissedInsights: appState?.dismissed_insights ?? [],
      assignedWeeks: (appState?.assigned_weeks ?? []).map((date: string) => dateOnly(date) ?? date),
      lastMonthProcessed: dateOnly(finance?.last_month_processed ?? null),
      lastPaydayProcessed: dateOnly(finance?.last_payday_processed ?? null),
      taxInfo: finance?.tax_info ?? null,
    };
  },

  async save(data: AppData, userId: string): Promise<void> {
    const client = getSupabaseClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    assertNoError(sessionError, 'verify active account');
    if (sessionData.session?.user.id !== userId) throw new Error('Your account changed before your data could be saved. Please sign in again.');

    const { error } = await client.rpc('replace_user_data', { p_data: data });
    assertNoError(error, 'save user data');

    // Meals and groceries reference the profile row written above, so they save second.
    const { error: foodError } = await client.rpc('replace_user_food', { p_meals: data.meals ?? [], p_groceries: data.groceries ?? [] });
    assertNoError(foodError, 'save meals and groceries');
  },

  async delete(userId: string): Promise<void> {
    const { error } = await getSupabaseClient().from('user_profiles').delete().eq('user_id', userId);
    assertNoError(error, 'delete user data');
  },
};
