import type { AppData } from '@/store/useStore';
import type { Category, Transaction } from '@/store/types';

export type FinanceScenario = 'demo' | 'worst' | 'empty' | 'one' | 'large';
export type FinanceScenarioData = Pick<
  AppData,
  'profile' | 'income' | 'weeklyFoodBudget' | 'bills' | 'transactions' | 'documents' | 'plan' | 'pantry' | 'goals' | 'weekHistory'
>;

export const FINANCE_SCENARIOS: readonly { value: FinanceScenario; label: string }[] = [
  { value: 'demo', label: 'Demo data' },
  { value: 'worst', label: 'Worst case' },
  { value: 'empty', label: 'Empty' },
  { value: 'one', label: 'One' },
  { value: 'large', label: '1,000 rows' },
];

const DATABASE_AMOUNT_LIMIT = 9_999_999_999.99;
const LONG_MERCHANT = 'Northwind Community Housing and Financial Services Cooperative';
const LONG_BILL = 'Northwind Holdings Retirement Contributions, Medical Aid and Life Cover';

function dateOffset(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseFinanceScenario(value: unknown): FinanceScenario {
  if (typeof value !== 'string') return 'demo';
  return FINANCE_SCENARIOS.find((scenario) => scenario.value === value)?.value ?? 'demo';
}

function transaction(
  id: string,
  daysAgo: number,
  merchant: string,
  amount: number,
  category: Category,
  kind: Transaction['kind'] = 'expense',
): Transaction {
  return {
    id,
    date: dateOffset(daysAgo),
    merchant,
    amount,
    kind,
    category,
    confidence: 'high',
  };
}

function stressData(data: FinanceScenarioData): FinanceScenarioData {
  const date = dateOffset(0);
  return {
    ...data,
    profile: { ...data.profile, name: 'Aleksandra Wiśniewska-Kowalczyk' },
    income: { net: 0, gross: null, frequency: 'monthly', employer: null, payday: 1, source: 'manual' },
    weeklyFoodBudget: 0,
    bills: [{
      id: 'dev-long-bill',
      name: LONG_BILL,
      amount: DATABASE_AMOUNT_LIMIT,
      day: 31,
      cadence: 'monthly',
      confidence: 'high',
      active: true,
      isSubscription: false,
    }],
    goals: [{
      id: 'dev-emergency-goal',
      type: 'emergency',
      name: 'Household emergency reserve',
      target: DATABASE_AMOUNT_LIMIT,
      current: DATABASE_AMOUNT_LIMIT,
      deadline: null,
      monthlyCommitted: 0,
      rules: [],
      contributions: [],
      createdAt: date,
    }],
    transactions: [
      transaction('dev-large-grocery', 0, LONG_MERCHANT, DATABASE_AMOUNT_LIMIT, 'food_grocery'),
      transaction('dev-short-name', 1, 'Jo', 0, 'other'),
      transaction('dev-dining', 2, 'Corner café and neighbourhood bakery', 1_250_000, 'food_dining'),
      transaction('dev-income', 3, 'Salary reversal and corrected deposit', 0, 'income', 'income'),
    ],
    documents: [{
      id: 'dev-long-document',
      name: 'FNB_Aspire_Current_Account_Statement_October_to_November_2026_Reviewed_and_Confirmed.pdf',
      type: 'bank_statement',
      hash: 'dev-finance-scenario',
      addedAt: `${date}T12:00:00.000Z`,
      status: 'confirmed',
      pages: 3,
      summary: 'Multi-page current account statement with confirmed transactions',
    }],
    plan: null,
    pantry: [],
    weekHistory: [],
  };
}

export function financeScenarioData(data: FinanceScenarioData, scenario: FinanceScenario): FinanceScenarioData {
  if (scenario === 'demo') return data;
  const stress = stressData(data);

  if (scenario === 'worst') return stress;
  if (scenario === 'empty') {
    return {
      ...stress,
      income: null,
      bills: [],
      goals: [],
      transactions: [],
      documents: [],
      weeklyFoodBudget: 0,
    };
  }
  if (scenario === 'one') {
    return {
      ...stress,
      bills: [],
      goals: [],
      transactions: [transaction('dev-single-transaction', 0, 'J', 0, 'other')],
      documents: [],
    };
  }

  const categories: Category[] = ['food_grocery', 'food_dining', 'transport', 'shopping', 'income', 'other'];
  return {
    ...stress,
    transactions: Array.from({ length: 1_000 }, (_, index) => {
      const category = categories[index % categories.length];
      const kind = category === 'income' ? 'income' : 'expense';
      const merchant = index === 0
        ? LONG_MERCHANT
        : index === 1
          ? 'Jo'
          : `Local merchant ${String(index + 1).padStart(4, '0')}`;
      const amount = index === 0 ? DATABASE_AMOUNT_LIMIT : index === 1 ? 0 : (index % 500) + 0.99;
      return transaction(`dev-large-${index}`, Math.floor(index / 10), merchant, amount, category, kind);
    }),
  };
}
