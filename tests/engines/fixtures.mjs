// Shared, deterministic fixtures for the pure-engine tests.
import { addDays } from '../../src/lib/dates.ts';

/** Fixed "today": Tuesday 10 November 2026 (week starts Monday 9 November). */
export const AS_OF = '2026-11-10';

/** Recursively freezes a value so any mutation inside an engine throws (ESM is strict mode). */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

let n = 0;
export const tx = (date, amount, category, extra = {}) => ({
  id: `t${++n}`,
  date,
  merchant: extra.merchant ?? category,
  amount,
  kind: extra.kind ?? 'expense',
  category,
  confidence: 'high',
  ...extra,
});

/** One transaction per day for `days` days ending the day before `end`. */
export const daily = (end, days, amount, category, extra) => Array.from({ length: days }, (_, i) => tx(addDays(end, -(i + 1)), amount, category, extra));

export const bill = (overrides = {}) => ({
  id: overrides.id ?? 'rent',
  name: 'Rent',
  amount: 5000,
  day: 1,
  cadence: 'monthly',
  confidence: 'high',
  active: true,
  isSubscription: false,
  ...overrides,
});

export const goal = (overrides = {}) => ({
  id: 'ef',
  type: 'emergency',
  name: 'Emergency Fund',
  target: 30000,
  current: 0,
  deadline: null,
  monthlyCommitted: 0,
  rules: [{ id: 'r1', kind: 'meal_surplus', enabled: true }],
  contributions: [],
  createdAt: '2026-10-01',
  ...overrides,
});

export const income = (net = 20000) => ({ net, gross: null, frequency: 'monthly', employer: null, payday: 25, source: 'manual' });

export const profile = (overrides = {}) => ({
  name: 'Test',
  email: '',
  householdSize: 2,
  currency: 'ZAR',
  diet: 'omnivore',
  allergies: [],
  calorieTarget: 2000,
  maxCookMinutes: 45,
  goalPriority: 'safety',
  ...overrides,
});

export const plannerInput = (overrides = {}) => ({
  profile: profile(overrides.profile),
  ceiling: 1100,
  pantry: [],
  tried: [],
  mode: 'normal',
  weekStart: '2026-11-09',
  seed: 42,
  generatedAt: '2026-11-09T08:00:00.000Z',
  iterations: 40,
  ...overrides,
  ...(overrides.profile ? { profile: profile(overrides.profile) } : {}),
});

export const appData = (overrides = {}) => ({
  onboarded: true,
  profile: profile(),
  settings: { themeMode: 'system', notifications: false, riskAlerts: true, weeklyDigest: true },
  manualMode: false,
  income: income(),
  weeklyFoodBudget: 1100,
  bills: [bill()],
  transactions: [],
  documents: [],
  plan: null,
  pendingPlan: null,
  pendingReason: null,
  pantry: [],
  groceryChecked: [],
  tried: [],
  goals: [goal()],
  foundMoney: [],
  weekHistory: [],
  dismissedInsights: [],
  assignedWeeks: [],
  lastMonthProcessed: '2026-11-01',
  lastPaydayProcessed: '2026-10-25',
  taxInfo: null,
  ...overrides,
});
