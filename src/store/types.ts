export type Currency = 'ZAR' | 'USD' | 'GBP' | 'EUR';
export type DietPattern = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'halal' | 'kosher';
export type Allergen = 'gluten' | 'dairy' | 'nuts' | 'eggs' | 'fish' | 'soy';
export type GoalPriority = 'safety' | 'debt' | 'invest' | 'understand';
export type Confidence = 'high' | 'medium' | 'low';
export type ThemeMode = 'system' | 'light' | 'dark';

export type Profile = {
  name: string;
  email: string;
  householdSize: number;
  currency: Currency;
  diet: DietPattern;
  allergies: Allergen[];
  calorieTarget: number; // per person per day
  maxCookMinutes: number; // per meal slot
  goalPriority: GoalPriority;
};

export type Settings = {
  themeMode: ThemeMode;
  notifications: boolean;
  riskAlerts: boolean;
  weeklyDigest: boolean;
};

export type IncomeFrequency = 'monthly' | 'biweekly' | 'weekly';

export type Income = {
  net: number;
  gross: number | null;
  frequency: IncomeFrequency;
  employer: string | null;
  payday: number; // day of month
  source: 'document' | 'manual';
};

export type Bill = {
  id: string;
  name: string;
  amount: number;
  day: number;
  cadence: 'monthly' | 'weekly';
  confidence: Confidence;
  active: boolean;
  isSubscription: boolean;
  usageNote?: string; // e.g. "opened 1× in 7 months"
  monthsPaid?: number;
};

export type Category =
  | 'food_grocery'
  | 'food_dining'
  | 'transport'
  | 'shopping'
  | 'entertainment'
  | 'health'
  | 'household'
  | 'bills'
  | 'income'
  | 'savings'
  | 'other';

export type Transaction = {
  id: string;
  date: string; // ISO date (yyyy-mm-dd)
  merchant: string;
  amount: number; // always positive
  kind: 'expense' | 'income' | 'transfer';
  category: Category;
  confidence: Confidence;
  question?: string; // low-confidence clarifying question
  alternatives?: Category[];
  sourceDocId?: string;
  lineItems?: ReceiptItem[];
};

export type ReceiptItem = {
  name: string;
  price: number;
  brand?: boolean;
  storeBrandPrice?: number;
  perishable?: boolean;
};

export type DocType = 'payslip' | 'bank_statement' | 'receipt' | 'tax_form' | 'unknown';

export type DocRecord = {
  id: string;
  name: string;
  type: DocType;
  hash: string;
  addedAt: string;
  status: 'confirmed' | 'failed' | 'needs_review';
  pages: number;
  summary: string;
};

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';
export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export type PlannedMeal = {
  recipeId: string;
  swaps: string[]; // ingredient keys with cheaper swap applied
  batchNote?: string;
  leftoverOf?: number; // day index the batch was cooked
  cooked?: boolean;
};

export type PlanDay = {
  date: string;
  slots: Record<MealSlot, PlannedMeal>;
  snacks: string[];
};

export type MealPlan = {
  weekStart: string;
  days: PlanDay[];
  ceiling: number;
  mode: 'normal' | 'budget_light';
  status: 'ok' | 'budget_floor_conflict';
  shortfall: number;
  generatedAt: string;
  seed: number;
};

export type PantryItem = { key: string; addedAt: string };

export type RuleKind = 'meal_surplus' | 'fixed' | 'percent' | 'roundup' | 'threshold';

export type Rule = {
  id: string;
  kind: RuleKind;
  amount?: number; // fixed amount / threshold / round-to
  percent?: number; // percent sweep
  enabled: boolean;
};

export type GoalType = 'emergency' | 'short_term' | 'investment';

export type Contribution = { id: string; date: string; amount: number; source: string };

export type Goal = {
  id: string;
  type: GoalType;
  name: string;
  target: number;
  current: number;
  deadline: string | null;
  monthlyCommitted: number;
  rules: Rule[];
  contributions: Contribution[];
  createdAt: string;
};

export type FoundMoneyKind = 'grocery_underspend' | 'subscription' | 'swap' | 'warning' | 'unallocated' | 'roundup';

export type FoundMoney = {
  id: string;
  amount: number;
  headline: string;
  source: string;
  kind: FoundMoneyKind;
  createdAt: string;
  status: 'pending' | 'allocated' | 'kept';
  allocations?: { goalId: string; amount: number }[];
  auto?: boolean;
};

export type WeekRecord = { weekStart: string; estimate: number; actual: number };
