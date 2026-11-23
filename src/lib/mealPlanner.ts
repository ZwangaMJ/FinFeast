/**
 * Weekly meal-plan constraint solver (spec §4.1 / §6.3), run on-device.
 *
 * Pipeline: validate → hard filters (diet, allergens, cook time) → budget ceiling
 * (try progressively frugal search strategies) → nutrition floor (calories ±10%,
 * protein) → batching (cook-once leftovers). Each candidate week is built by a
 * pure fold that threads the random generator, the opened-packs ledger and the
 * days so far as explicit state; nothing reads the clock or mutates its input.
 * An unaffordable week is an honest `budget_floor_conflict` error that still
 * carries the cheapest adequate plan.
 */
import type { Aisle, Recipe } from '@/data/recipes';
import { activeRecipes, getIngredient, getRecipe } from '@/lib/catalog';
import { addDays, DAY_LONG, weekday } from '@/lib/dates';
import { err, minBy, nextFloat, ok, range, round2, sum, type DeepReadonly, type Result, type Rng, seedRng } from '@/lib/fp';
import { PRICE_FACTOR } from '@/lib/format';
import { MEAL_SLOTS, type MealPlan, type MealSlot, type PlanDay, type PlannedMeal, type Profile } from '@/store/types';

export const PROTEIN_FLOOR_G = 50;
export const ESTIMATE_SPREAD = 0.12;
const MAX_NEW_PER_WEEK = 2;
const MAX_SNACKS = 2;
const DEFAULT_ITERATIONS = 140;

type Currency = Profile['currency'];
type PlannerProfile = Pick<Profile, 'diet' | 'allergies' | 'calorieTarget' | 'maxCookMinutes' | 'householdSize' | 'currency'>;
type Day = DeepReadonly<PlanDay>;
type Days = readonly Day[];
type Meal = DeepReadonly<PlannedMeal>;

export const lockKey = (day: number, slot: MealSlot) => `${day}:${slot}`;

export type PlannerInput = DeepReadonly<{
  profile: PlannerProfile;
  ceiling: number;
  pantry: string[];
  tried: string[];
  mode: MealPlan['mode'];
  weekStart: string;
  seed: number;
  /** Timestamp stamped on the plan (supplied by the caller; the solver never reads the clock). */
  generatedAt: string;
  /** Slots to keep as-is, keyed by `lockKey(day, slot)` (single meal / single day regeneration). */
  locked?: Record<string, PlannedMeal>;
  /** Recipe to avoid in a given slot, so a regeneration actually changes something. */
  exclude?: { day: number; slot: MealSlot; recipeId: string };
  iterations?: number;
}>;

/** What stays the same across regenerations of one plan. */
export type PlannerBase = Omit<PlannerInput, 'weekStart' | 'seed' | 'generatedAt' | 'locked' | 'exclude'>;

export type NutritionReport = Readonly<{
  perDay: readonly Readonly<{ date: string; kcal: number; protein: number; withinBand: boolean; proteinOk: boolean }>[];
  bandMet: boolean;
  floorMet: boolean;
}>;

export type StrategyName = 'preferred' | 'balanced' | 'floor';

export type PlanSolution = Readonly<{
  plan: MealPlan;
  cost: number;
  strategy: StrategyName;
  nutrition: NutritionReport;
  /** Slots where no recipe fit the cook-time cap, so the cap was relaxed. */
  relaxedCookTime: readonly MealSlot[];
}>;

export type PlannerError =
  | Readonly<{ kind: 'invalid_input'; reason: string }>
  | Readonly<{ kind: 'no_eligible_recipes'; slots: readonly MealSlot[] }>
  | Readonly<{ kind: 'budget_floor_conflict'; shortfall: number; cheapestCost: number; fallback: MealPlan; nutrition: NutritionReport }>;

export type GroceryItem = Readonly<{
  id: string; // ingredient key, with "~swap" suffix if the cheaper swap applies
  key: string;
  name: string;
  aisle: Aisle;
  qty: string;
  packs: number;
  estPrice: number;
  usedIn: readonly number[]; // day indexes
  pantryCredit: boolean;
}>;

// ---------------------------------------------------------------------------
// Recipe facts

export function dietAllows(r: Recipe, diet: Profile['diet']) {
  switch (diet) {
    case 'vegan':
      return r.vegan;
    case 'vegetarian':
      return r.meat === 'none';
    case 'pescatarian':
      return r.meat === 'none' || r.meat === 'fish';
    case 'kosher':
      return !((r.meat === 'poultry' || r.meat === 'red') && r.dairy);
    default:
      return true;
  }
}

export function eligible(r: Recipe, p: DeepReadonly<PlannerProfile>, ignoreTime = false) {
  if (!dietAllows(r, p.diet)) return false;
  if (r.allergens.some((a) => p.allergies.includes(a))) return false;
  if (!ignoreTime && r.minutes > p.maxCookMinutes) return false;
  return true;
}

export function unitPrice(key: string, swapped: boolean, currency: Currency) {
  const ing = getIngredient(key);
  const base = swapped && ing.swap ? ing.price * (1 - ing.swap.saveFraction) : ing.price;
  return base * PRICE_FACTOR[currency];
}

/** Cost of one serving, attributing a share of each pack. */
export function servingCost(recipeId: string, swaps: readonly string[], currency: Currency) {
  return sum(getRecipe(recipeId).ingredients.map((i) => i.use * unitPrice(i.key, swaps.includes(i.key), currency)));
}

export function swapOptions(recipeId: string, currency: Currency) {
  return getRecipe(recipeId).ingredients
    .filter((i) => getIngredient(i.key).swap)
    .map((i) => {
      const ing = getIngredient(i.key);
      const saving = i.use * ing.price * ing.swap!.saveFraction * PRICE_FACTOR[currency];
      return { key: i.key, from: ing.name, to: ing.swap!.name, label: ing.swap!.label, saving };
    });
}

export const allSwapKeys = (recipeId: string): string[] => getRecipe(recipeId).ingredients.filter((i) => getIngredient(i.key).swap).map((i) => i.key);

const mealsOf = (day: Day): readonly Readonly<{ recipeId: string; swaps: readonly string[] }>[] => [
  ...MEAL_SLOTS.map((s) => day.slots[s]),
  ...day.snacks.map((id) => ({ recipeId: id, swaps: [] as readonly string[] })),
];

export function dayNutrition(day: Day) {
  return mealsOf(day).reduce(
    (acc, m) => {
      const r = getRecipe(m.recipeId);
      return { kcal: acc.kcal + r.kcal, protein: acc.protein + r.protein };
    },
    { kcal: 0, protein: 0 },
  );
}

// ---------------------------------------------------------------------------
// Copies (store types are mutable, so everything returned is a fresh object)

const copyMeal = (m: Meal): PlannedMeal => ({ ...m, swaps: [...m.swaps] });
const mapSlots = (slots: Day['slots'], f: (m: Meal, slot: MealSlot) => PlannedMeal): Record<MealSlot, PlannedMeal> =>
  ({ breakfast: f(slots.breakfast, 'breakfast'), lunch: f(slots.lunch, 'lunch'), dinner: f(slots.dinner, 'dinner') });
const copyDay = (d: Day): PlanDay => ({ date: d.date, snacks: [...d.snacks], slots: mapSlots(d.slots, copyMeal) });

/** Every meal in the plan with its available cheaper swaps applied. */
export function withAllSwaps<P extends DeepReadonly<MealPlan>>(plan: P): MealPlan {
  return { ...plan, days: plan.days.map((d) => ({ ...copyDay(d), slots: mapSlots(d.slots, (m) => ({ ...copyMeal(m), swaps: allSwapKeys(m.recipeId) })) })) };
}

// ---------------------------------------------------------------------------
// Grocery list & cost

type Usage = Readonly<{ use: number; swappedUse: number; usedIn: readonly number[] }>;
const AISLE_ORDER: readonly Aisle[] = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen', 'Other'];

/** Σ ingredient use per key across the week, for a household (first-use order). */
const ingredientUsage = (days: Days, householdSize: number): readonly (readonly [string, Usage])[] =>
  Object.entries(
    days.reduce<Readonly<Record<string, Usage>>>(
      (acc, day, di) =>
        mealsOf(day).reduce(
          (a, m) =>
            getRecipe(m.recipeId).ingredients.reduce((b, i) => {
              const prev = b[i.key] ?? { use: 0, swappedUse: 0, usedIn: [] };
              const u = i.use * householdSize;
              const swapped = m.swaps.includes(i.key) && !!getIngredient(i.key).swap;
              return { ...b, [i.key]: { use: prev.use + u, swappedUse: prev.swappedUse + (swapped ? u : 0), usedIn: prev.usedIn.includes(di) ? prev.usedIn : [...prev.usedIn, di] } };
            }, a),
          acc,
        ),
      {},
    ),
  );

const toGroceryItem = (pantry: readonly string[], currency: Currency) => ([key, u]: readonly [string, Usage]): GroceryItem => {
  const ing = getIngredient(key);
  // The cheaper variant is bought when most of the week's use has the swap applied
  const swapped = u.swappedUse > 0 && u.swappedUse >= u.use / 2;
  const packsNeeded = Math.max(1, Math.ceil(u.use - 0.001));
  const inPantry = pantry.includes(key) || !!ing.staple;
  const packs = inPantry ? Math.max(0, packsNeeded - 1) : packsNeeded;
  return {
    id: swapped ? `${key}~swap` : key,
    key,
    name: swapped ? ing.swap!.name : ing.name,
    aisle: ing.aisle,
    qty: packs === 0 ? 'In pantry' : ing.pack === 'serving' ? `${packs} serving${packs > 1 ? 's' : ''}` : swapped ? `${packs} pack${packs > 1 ? 's' : ''}` : `${packs} × ${ing.pack}`,
    packs,
    estPrice: packs * unitPrice(key, swapped, currency),
    usedIn: u.usedIn,
    pantryCredit: inPantry,
  };
};

/** Consolidated grocery list: Σ ingredients − pantry credits, rounded up to whole packs. */
export function buildGroceryList(days: Days, householdSize: number, pantry: readonly string[], currency: Currency): readonly GroceryItem[] {
  return ingredientUsage(days, householdSize)
    .map(toGroceryItem(pantry, currency))
    .sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

/** The grocery list's total, without building and sorting the display list. */
export const planCost = (days: Days, householdSize: number, pantry: readonly string[], currency: Currency) =>
  sum(ingredientUsage(days, householdSize).map((entry) => toGroceryItem(pantry, currency)(entry).estPrice));

export const estimateRange = (mid: number): [number, number] => [mid * (1 - ESTIMATE_SPREAD), mid * (1 + ESTIMATE_SPREAD)];

// ---------------------------------------------------------------------------
// Batching: keep cook-once leftover links consistent (returns a new week)

export function relinkBatches(days: Days): PlanDay[] {
  const lunches = days.map((day): PlannedMeal => {
    const lunch = copyMeal(day.slots.lunch);
    if (lunch.leftoverOf === undefined) return lunch;
    const src = days[lunch.leftoverOf]?.slots.dinner;
    return src && src.recipeId === lunch.recipeId ? lunch : { ...lunch, leftoverOf: undefined, batchNote: undefined };
  });
  return days.map((day, d) => {
    const coversNext = lunches[d + 1]?.leftoverOf === d;
    const dinner = { ...copyMeal(day.slots.dinner), batchNote: coversNext ? `Cook once, covers ${DAY_LONG[weekday(days[d + 1].date)]}'s lunch` : undefined };
    return { ...copyDay(day), slots: { breakfast: copyMeal(day.slots.breakfast), lunch: lunches[d], dinner } };
  });
}

// ---------------------------------------------------------------------------
// Stage 1: validation

function validateInput(input: PlannerInput): Result<PlannerInput, PlannerError> {
  const { profile, ceiling, weekStart, iterations } = input;
  if (!Number.isInteger(profile.householdSize) || profile.householdSize < 1) return err({ kind: 'invalid_input', reason: 'Household size must be a whole number of at least 1.' });
  if (!(profile.calorieTarget > 0)) return err({ kind: 'invalid_input', reason: 'Calorie target must be positive.' });
  if (!Number.isFinite(ceiling) || ceiling < 0) return err({ kind: 'invalid_input', reason: 'Food budget must be zero or more.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return err({ kind: 'invalid_input', reason: 'Week start must be yyyy-mm-dd.' });
  if (iterations !== undefined && !(iterations >= 1)) return err({ kind: 'invalid_input', reason: 'Iterations must be at least 1.' });
  return ok(input);
}

// ---------------------------------------------------------------------------
// Stage 2: hard filters

type PoolSlot = MealSlot | 'snack';
type Pools = Readonly<Record<PoolSlot, readonly Recipe[]>>;
type Filtered = Readonly<{ pools: Pools; relaxedCookTime: readonly MealSlot[] }>;
const POOL_SLOTS: readonly PoolSlot[] = [...MEAL_SLOTS, 'snack'];

export function hardFilter(profile: DeepReadonly<PlannerProfile>): Result<Filtered, PlannerError> {
  const filter = (slot: PoolSlot) => {
    const strict = activeRecipes().filter((r) => r.slot === slot && eligible(r, profile));
    const recipes = strict.length ? strict : activeRecipes().filter((r) => r.slot === slot && eligible(r, profile, true));
    return { slot, recipes, relaxed: strict.length === 0 && recipes.length > 0 };
  };
  const [breakfast, lunch, dinner, snack] = POOL_SLOTS.map(filter);
  const meals = [breakfast, lunch, dinner];
  const missing = meals.filter((e) => e.recipes.length === 0).map((e) => e.slot as MealSlot);
  if (missing.length) return err({ kind: 'no_eligible_recipes', slots: missing });
  return ok({
    pools: { breakfast: breakfast.recipes, lunch: lunch.recipes, dinner: dinner.recipes, snack: snack.recipes },
    relaxedCookTime: meals.filter((e) => e.relaxed).map((e) => e.slot as MealSlot),
  });
}

export const hasRecipesFor = (profile: DeepReadonly<PlannerProfile>) => hardFilter(profile).ok;

// ---------------------------------------------------------------------------
// Candidate construction (a pure fold over days and slots)

type Ledger = Readonly<Record<string, number>>; // packs opened so far, per ingredient
type BuildState = Readonly<{ rng: Rng; ledger: Ledger; newCount: number; days: readonly PlanDay[] }>;
type SearchCtx = Readonly<{ input: PlannerInput; pools: Pools; mode: MealPlan['mode']; costWeight: number }>;

const isCredited = (input: PlannerInput) => (key: string) => input.pantry.includes(key) || !!getIngredient(key).staple;

const consume = (ledger: Ledger, recipeId: string, hh: number): Ledger =>
  getRecipe(recipeId).ingredients.reduce((l, i) => ({ ...l, [i.key]: (l[i.key] ?? 0) + i.use * hh }), ledger);

/** Extra packs (base price) a recipe forces us to open, given what's already open. */
const marginalCost = (ctx: SearchCtx, ledger: Ledger, r: Recipe, swaps: readonly string[]) => {
  const hh = ctx.input.profile.householdSize;
  const credited = isCredited(ctx.input);
  return sum(
    r.ingredients.map((i) => {
      if (credited(i.key)) return 0;
      const used = ledger[i.key] ?? 0;
      const packs = Math.ceil(used + i.use * hh - 0.001) - Math.ceil(used - 0.001);
      const ing = getIngredient(i.key);
      return packs * ing.price * (swaps.includes(i.key) && ing.swap ? 1 - ing.swap.saveFraction : 1);
    }),
  );
};

const swapsFor = (ctx: SearchCtx, recipeId: string): string[] => (ctx.mode === 'budget_light' ? allSwapKeys(recipeId) : []);
const isNew = (ctx: SearchCtx, recipeId: string) => !ctx.input.tried.includes(recipeId);
const isExcluded = (ctx: SearchCtx, d: number, slot: MealSlot, recipeId: string) => {
  const ex = ctx.input.exclude;
  return !!ex && ex.day === d && ex.slot === slot && ex.recipeId === recipeId;
};

/** Deterministic part of a candidate's score: cost, variety and novelty. Lower is better. */
function candidateScore(ctx: SearchCtx, state: BuildState, d: number, slot: MealSlot, r: Recipe) {
  const { profile } = ctx.input;
  const swaps = swapsFor(ctx, r.id);
  const share = (servingCost(r.id, swaps, profile.currency) / PRICE_FACTOR[profile.currency]) * profile.householdSize;
  const costTerm = (share * 0.5 + marginalCost(ctx, state.ledger, r, swaps) * 0.5) * ctx.costWeight * 0.5;
  const recent = state.days.slice(Math.max(0, d - 3));
  const repeatsDish = recent.some((pd) => MEAL_SLOTS.some((s) => pd.slots[s].recipeId === r.id && pd.slots[s].leftoverOf === undefined));
  const repeatsProtein = slot !== 'breakfast' && recent.some((pd) => getRecipe(pd.slots[slot].recipeId).mainProtein === r.mainProtein);
  const overNovelty = isNew(ctx, r.id) && state.newCount >= MAX_NEW_PER_WEEK;
  return costTerm + (repeatsDish ? 60 : 0) + (repeatsProtein ? 18 : 0) + (overNovelty ? 45 : 0);
}

type Choice = Readonly<{ meal: PlannedMeal; state: BuildState }>;

function chooseMeal(ctx: SearchCtx, state: BuildState, d: number, slot: MealSlot): Choice {
  const hh = ctx.input.profile.householdSize;
  const take = (meal: PlannedMeal, s: BuildState): Choice => ({
    meal,
    state: { ...s, ledger: consume(s.ledger, meal.recipeId, hh), newCount: s.newCount + (meal.leftoverOf === undefined && isNew(ctx, meal.recipeId) ? 1 : 0) },
  });

  const keep = ctx.input.locked?.[lockKey(d, slot)];
  if (keep) return take(copyMeal(keep), state);

  // Batch cooking: yesterday's batch-friendly dinner usually covers today's lunch
  const prevDinner = state.days[d - 1]?.slots.dinner;
  const prevRecipe = prevDinner ? getRecipe(prevDinner.recipeId) : undefined;
  const avoidLeftover = isExcluded(ctx, d, slot, prevDinner?.recipeId ?? '');
  const afterLeftoverDraw = ((): Choice | BuildState => {
    if (slot !== 'lunch' || !prevRecipe?.batch || avoidLeftover) return state;
    const [roll, rng] = nextFloat(state.rng);
    const next = { ...state, rng };
    return roll < 0.75 ? take({ recipeId: prevRecipe.id, swaps: [...prevDinner!.swaps], leftoverOf: d - 1 }, next) : next;
  })();
  if ('meal' in afterLeftoverDraw) return afterLeftoverDraw;

  const pool = ctx.pools[slot];
  const picked = pool.reduce<Readonly<{ rng: Rng; best?: Readonly<{ recipe: Recipe; score: number }> }>>(
    (acc, r) => {
      if (isExcluded(ctx, d, slot, r.id)) return acc;
      const [noise, rng] = nextFloat(acc.rng);
      const score = candidateScore(ctx, afterLeftoverDraw, d, slot, r) + noise * 22;
      return { rng, best: !acc.best || score < acc.best.score ? { recipe: r, score } : acc.best };
    },
    { rng: afterLeftoverDraw.rng },
  );
  const recipe = picked.best?.recipe ?? pool[0];
  return take({ recipeId: recipe.id, swaps: swapsFor(ctx, recipe.id) }, { ...afterLeftoverDraw, rng: picked.rng });
}

/** Snacks top up calories toward the band, preferring ones that use packs already opened. */
function topUpSnacks(ctx: SearchCtx, state: BuildState, day: PlanDay): Readonly<{ snacks: string[]; state: BuildState }> {
  const target = ctx.input.profile.calorieTarget;
  const hh = ctx.input.profile.householdSize;
  const keyed = ctx.pools.snack.reduce<Readonly<{ rng: Rng; list: readonly Readonly<{ recipe: Recipe; key: number }>[] }>>(
    (acc, s) => {
      const [r, rng] = nextFloat(acc.rng);
      return { rng, list: [...acc.list, { recipe: s, key: marginalCost(ctx, state.ledger, s, []) + (r - 0.5) * 20 }] };
    },
    { rng: state.rng, list: [] },
  );
  const ordered = [...keyed.list].sort((a, b) => a.key - b.key).map((x) => x.recipe);
  const filled = ordered.reduce<Readonly<{ snacks: readonly string[]; kcal: number; ledger: Ledger; done: boolean }>>(
    (acc, s) => {
      if (acc.done || acc.kcal >= target * 0.92 || acc.snacks.length >= MAX_SNACKS) return { ...acc, done: true };
      if (acc.kcal + s.kcal > target * 1.1) return acc;
      return { ...acc, snacks: [...acc.snacks, s.id], kcal: acc.kcal + s.kcal, ledger: consume(acc.ledger, s.id, hh) };
    },
    { snacks: [], kcal: dayNutrition(day).kcal, ledger: state.ledger, done: false },
  );
  return { snacks: [...filled.snacks], state: { ...state, rng: keyed.rng, ledger: filled.ledger } };
}

const buildDay = (ctx: SearchCtx) => (state: BuildState, d: number): BuildState => {
  const chosen = MEAL_SLOTS.reduce<Readonly<{ slots: Partial<Record<MealSlot, PlannedMeal>>; state: BuildState }>>(
    (acc, slot) => {
      const c = chooseMeal(ctx, acc.state, d, slot);
      return { slots: { ...acc.slots, [slot]: c.meal }, state: c.state };
    },
    { slots: {}, state },
  );
  const day: PlanDay = { date: addDays(ctx.input.weekStart, d), slots: chosen.slots as Record<MealSlot, PlannedMeal>, snacks: [] };
  const topped = topUpSnacks(ctx, chosen.state, day);
  return { ...topped.state, days: [...topped.state.days, { ...day, snacks: topped.snacks }] };
};

const buildCandidate = (ctx: SearchCtx, rng: Rng): Readonly<{ days: PlanDay[]; rng: Rng }> => {
  const final = range(7).reduce(buildDay(ctx), { rng, ledger: {}, newCount: 0, days: [] });
  return { days: relinkBatches(final.days), rng: final.rng };
};

// ---------------------------------------------------------------------------
// Scoring: a sum of independent penalty functions

type PenaltyCtx = Readonly<{ input: PlannerInput; costWeight: number }>;
type Penalty = (ctx: PenaltyCtx, days: Days, cost: number) => number;

const factor = (ctx: PenaltyCtx) => PRICE_FACTOR[ctx.input.profile.currency];

const budgetPenalty: Penalty = (ctx, _days, cost) => (Math.max(0, cost - ctx.input.ceiling) * 4) / factor(ctx);

const nutritionPenalty: Penalty = (ctx, days) => {
  const lo = ctx.input.profile.calorieTarget * 0.9;
  const hi = ctx.input.profile.calorieTarget * 1.1;
  return sum(
    days.map((day) => {
      const n = dayNutrition(day);
      return (n.kcal < lo ? 40 + (lo - n.kcal) * 0.2 : 0) + (n.kcal > hi ? 30 : 0) + (n.protein < PROTEIN_FLOOR_G ? 40 : 0);
    }),
  );
};

const noveltyPenalty: Penalty = (ctx, days) => {
  const fresh = new Set(days.flatMap((d) => MEAL_SLOTS.map((s) => d.slots[s].recipeId)).filter((id) => !ctx.input.tried.includes(id)));
  return Math.max(0, fresh.size - MAX_NEW_PER_WEEK) * 25;
};

/** No repeated dish or main protein within 4 days (leftovers excepted), and at least 5 distinct dinners. */
const varietyPenalty: Penalty = (_ctx, days) => {
  const repeats = sum(
    days.map((day, d) => {
      const window = days.slice(Math.max(0, d - 3), d);
      return sum(
        MEAL_SLOTS.map((slot) => {
          const m = day.slots[slot];
          if (m.leftoverOf !== undefined) return 0;
          const dish = window.some((w) => MEAL_SLOTS.some((s) => w.slots[s].recipeId === m.recipeId && w.slots[s].leftoverOf === undefined)) ? 30 : 0;
          const protein = slot === 'dinner' && window.some((w) => getRecipe(w.slots.dinner.recipeId).mainProtein === getRecipe(m.recipeId).mainProtein) ? 12 : 0;
          return dish + protein;
        }),
      );
    }),
  );
  const distinctDinners = new Set(days.map((d) => d.slots.dinner.recipeId)).size;
  return repeats + Math.max(0, 5 - distinctDinners) * 45;
};

const costPenalty: Penalty = (ctx, _days, cost) => (cost / factor(ctx)) * ctx.costWeight * 0.1;

const PENALTIES: readonly Penalty[] = [budgetPenalty, nutritionPenalty, noveltyPenalty, varietyPenalty, costPenalty];

type Scored = Readonly<{ days: PlanDay[]; cost: number; penalty: number }>;

const scoreWeek = (ctx: PenaltyCtx, days: PlanDay[]): Scored => {
  const { profile, pantry } = ctx.input;
  const cost = planCost(days, profile.householdSize, pantry, profile.currency);
  return { days, cost, penalty: sum(PENALTIES.map((p) => p(ctx, days, cost))) };
};

// ---------------------------------------------------------------------------
// Stage 3: budget ceiling — search strategies from preferred to most frugal

type Strategy = Readonly<{ name: StrategyName; mode: MealPlan['mode']; costWeight: number; seedOffset: number }>;

const strategiesFor = (mode: MealPlan['mode']): readonly Strategy[] => [
  { name: 'preferred', mode, costWeight: mode === 'budget_light' ? 1.6 : 0.5, seedOffset: 0 },
  // Budget outranks variety: a budget-light week that keeps variety…
  { name: 'balanced', mode: 'budget_light', costWeight: 2.5, seedOffset: 7 },
  // …then the cheapest week that still meets the nutrition floor (nutrition outranks budget)
  { name: 'floor', mode: 'budget_light', costWeight: 6, seedOffset: 13 },
];

type Searched = Scored & Readonly<{ strategy: StrategyName }>;

function search(input: PlannerInput, pools: Pools, strategy: Strategy): Searched {
  const ctx: SearchCtx = { input, pools, mode: strategy.mode, costWeight: strategy.costWeight };
  const result = range(input.iterations ?? DEFAULT_ITERATIONS).reduce<Readonly<{ rng: Rng; best?: Scored }>>(
    (acc) => {
      const cand = buildCandidate(ctx, acc.rng);
      const scored = scoreWeek(ctx, cand.days);
      return { rng: cand.rng, best: !acc.best || scored.penalty < acc.best.penalty ? scored : acc.best };
    },
    { rng: seedRng(input.seed + strategy.seedOffset) },
  );
  return { ...result.best!, strategy: strategy.name };
}

type Fit = Readonly<{ chosen: Searched; within: boolean }>;

/** Runs strategies lazily in order and stops at the first week within the ceiling. */
function fitToCeiling(input: PlannerInput, pools: Pools): Fit {
  const attempt = (remaining: readonly Strategy[], tried: readonly Searched[]): Fit => {
    if (!remaining.length) return { chosen: minBy(tried, (s) => s.cost)!, within: false };
    const result = search(input, pools, remaining[0]);
    return result.cost <= input.ceiling ? { chosen: result, within: true } : attempt(remaining.slice(1), [...tried, result]);
  };
  return attempt(strategiesFor(input.mode), []);
}

// ---------------------------------------------------------------------------
// Stage 4: nutrition floor report

export function nutritionReport(days: Days, profile: DeepReadonly<PlannerProfile>): NutritionReport {
  const perDay = days.map((d) => {
    const n = dayNutrition(d);
    return {
      date: d.date,
      kcal: n.kcal,
      protein: n.protein,
      withinBand: n.kcal >= profile.calorieTarget * 0.9 && n.kcal <= profile.calorieTarget * 1.1,
      proteinOk: n.protein >= PROTEIN_FLOOR_G,
    };
  });
  return { perDay, bandMet: perDay.every((d) => d.withinBand), floorMet: perDay.every((d) => d.proteinOk) };
}

// ---------------------------------------------------------------------------
// Solver

const toMealPlan = (input: PlannerInput, days: PlanDay[], status: MealPlan['status'], shortfall: number): MealPlan => ({
  weekStart: input.weekStart,
  days,
  ceiling: input.ceiling,
  mode: input.mode,
  status,
  shortfall,
  generatedAt: input.generatedAt,
  seed: input.seed,
});

/**
 * Solves a week. Same input (including seed) → same plan, every time.
 * Errors: invalid input, a slot with no eligible recipes, or a budget below the
 * nutrition floor (with the cheapest adequate plan as `fallback`).
 */
export function solvePlan(input: PlannerInput): Result<PlanSolution, PlannerError> {
  const valid = validateInput(input);
  if (!valid.ok) return valid;
  const filtered = hardFilter(input.profile);
  if (!filtered.ok) return filtered;

  const fit = fitToCeiling(input, filtered.value.pools);
  const days = relinkBatches(fit.chosen.days);
  const nutrition = nutritionReport(days, input.profile);
  if (!fit.within) {
    const shortfall = Math.ceil(fit.chosen.cost - input.ceiling);
    return err({ kind: 'budget_floor_conflict', shortfall, cheapestCost: round2(fit.chosen.cost), fallback: toMealPlan(input, days, 'budget_floor_conflict', shortfall), nutrition });
  }
  return ok({ plan: toMealPlan(input, days, 'ok', 0), cost: fit.chosen.cost, strategy: fit.chosen.strategy, nutrition, relaxedCookTime: filtered.value.relaxedCookTime });
}

/** The plan to show: the solved plan, or the honest cheapest plan on a budget conflict. */
export function planOrFallback(r: Result<PlanSolution, PlannerError>): MealPlan | null {
  if (r.ok) return r.value.plan;
  return r.error.kind === 'budget_floor_conflict' ? r.error.fallback : null;
}

// ---------------------------------------------------------------------------
// Regeneration (lock everything except the target slots)

export function lockSlots(plan: DeepReadonly<MealPlan>, keep: (day: number, slot: MealSlot) => boolean): Record<string, PlannedMeal> {
  return Object.fromEntries(plan.days.flatMap((d, i) => MEAL_SLOTS.filter((s) => keep(i, s)).map((s) => [lockKey(i, s), copyMeal(d.slots[s])])));
}

type Regen = Readonly<{ seed: number; generatedAt: string }>;

/** Regenerate one meal, keeping every other slot and the budget/calorie constraints. */
export function regenerateSlot(plan: DeepReadonly<MealPlan>, base: PlannerBase, day: number, slot: MealSlot, regen: Regen) {
  const unlockNextLunch = slot === 'dinner' && plan.days[day + 1]?.slots.lunch.leftoverOf === day;
  return solvePlan({
    ...base,
    weekStart: plan.weekStart,
    seed: regen.seed,
    generatedAt: regen.generatedAt,
    iterations: 60,
    exclude: { day, slot, recipeId: plan.days[day].slots[slot].recipeId },
    locked: lockSlots(plan, (d, s) => !(d === day && s === slot) && !(unlockNextLunch && d === day + 1 && s === 'lunch')),
  });
}

export function regenerateDay(plan: DeepReadonly<MealPlan>, base: PlannerBase, day: number, regen: Regen) {
  const unlockNextLunch = plan.days[day + 1]?.slots.lunch.leftoverOf === day;
  return solvePlan({
    ...base,
    weekStart: plan.weekStart,
    seed: regen.seed,
    generatedAt: regen.generatedAt,
    iterations: 80,
    exclude: { day, slot: 'dinner', recipeId: plan.days[day].slots.dinner.recipeId },
    locked: lockSlots(plan, (d, s) => d !== day && !(unlockNextLunch && d === day + 1 && s === 'lunch')),
  });
}
