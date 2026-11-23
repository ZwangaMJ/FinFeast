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

/** A resolved food photo (hotlinked from the provider) with its attribution. */
export type FoodImageRef = {
  url: string;
  thumbUrl?: string | null;
  /** e.g. "Jane Doe" */
  photographer?: string | null;
  photographerUrl?: string | null;
  /** The photo's page on the provider (attribution link). */
  sourceUrl?: string | null;
  provider?: string | null;
};

export type MealKind = MealSlot | 'snack';
/** What a meal contains, from most to least restrictive. */
export type MealDiet = 'vegan' | 'vegetarian' | 'fish' | 'poultry' | 'red';
export type CustomIngredient = { name: string; qty?: number | null; unit?: string | null };

/**
 * A user's meal. Either a brand-new meal (`baseRecipeId` null) or the user's edited copy of
 * a built-in recipe (`baseRecipeId` set). `hidden` on an edited copy removes that built-in
 * from the user's planner. `costPerServing` null keeps the built-in's ingredient pricing;
 * otherwise the meal is priced per serving in `costCurrency`.
 */
export type UserMeal = {
  id: string;
  baseRecipeId: string | null;
  hidden: boolean;
  name: string;
  slot: MealKind;
  emoji: string;
  kcal: number;
  protein: number;
  minutes: number;
  costPerServing: number | null;
  costCurrency: Currency;
  diet: MealDiet;
  allergens: Allergen[];
  ingredients: CustomIngredient[];
  notes: string;
  steps: string[];
  image: FoodImageRef | null;
  createdAt: string;
  updatedAt: string;
};

/** A grocery item the user added (standalone, or for one of their meals). */
export type GroceryEntry = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  estCost: number | null;
  costCurrency: Currency;
  checked: boolean;
  /** A recipe id (built-in or `u_<meal id>`) this item is for, if any. */
  mealId: string | null;
  emoji: string;
  image: FoodImageRef | null;
  createdAt: string;
  updatedAt: string;
};

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

/** The persisted app state (everything except store actions). */
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
  /** User-created meals and edited/hidden copies of built-in recipes. */
  meals: UserMeal[];
  /** Grocery items the user added by hand. */
  groceries: GroceryEntry[];
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
