/**
 * Weekly meal-plan constraint solver (spec §4.1 / §6.3), run on-device.
 *
 * Solver order: hard filters (diet, allergens, cook time) → budget ceiling →
 * calorie band (±10% of target) and protein floor → variety (no repeated dish
 * or main protein within 4 days, ≤2 new recipes/week) → batch-cook leftovers.
 * It samples many candidate weeks and keeps the one with the lowest penalty.
 */
import { INGREDIENTS, RECIPES, RECIPE_BY_ID, type Aisle, type Recipe } from '@/data/recipes';
import { addDays, DAY_LONG, weekday } from '@/lib/dates';
import { PRICE_FACTOR } from '@/lib/format';
import { MEAL_SLOTS, type MealPlan, type MealSlot, type PlanDay, type PlannedMeal, type Profile } from '@/store/types';

export const PROTEIN_FLOOR_G = 50;
export const ESTIMATE_SPREAD = 0.12;
const MAX_NEW_PER_WEEK = 2;
const MAX_SNACKS = 2;

type PlannerProfile = Pick<Profile, 'diet' | 'allergies' | 'calorieTarget' | 'maxCookMinutes' | 'householdSize' | 'currency'>;

export type PlannerInput = {
  profile: PlannerProfile;
  ceiling: number;
  pantry: string[];
  tried: string[];
  mode: MealPlan['mode'];
  weekStart: string;
  seed: number;
  /** Slots to keep as-is (used for single meal / single day regeneration). */
  locked?: (day: number, slot: MealSlot) => PlannedMeal | undefined;
  /** Recipe to avoid in a given slot (so a regeneration actually changes something). */
  exclude?: { day: number; slot: MealSlot; recipeId: string };
  iterations?: number;
};

export type GroceryItem = {
  id: string; // ingredient key, with "~swap" suffix if the cheaper swap applies
  key: string;
  name: string;
  aisle: Aisle;
  qty: string;
  packs: number;
  estPrice: number;
  usedIn: number[]; // day indexes
  pantryCredit: boolean;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

export function eligible(r: Recipe, p: PlannerProfile, ignoreTime = false) {
  if (!dietAllows(r, p.diet)) return false;
  if (r.allergens.some((a) => p.allergies.includes(a))) return false;
  if (!ignoreTime && r.minutes > p.maxCookMinutes) return false;
  return true;
}

export function unitPrice(key: string, swapped: boolean, currency: Profile['currency']) {
  const ing = INGREDIENTS[key];
  const base = swapped && ing.swap ? ing.price * (1 - ing.swap.saveFraction) : ing.price;
  return base * PRICE_FACTOR[currency];
}

/** Cost of one serving, attributing a share of each pack. */
export function servingCost(recipeId: string, swaps: string[], currency: Profile['currency']) {
  const r = RECIPE_BY_ID[recipeId];
  return r.ingredients.reduce((sum, i) => sum + i.use * unitPrice(i.key, swaps.includes(i.key), currency), 0);
}

export function swapOptions(recipeId: string, currency: Profile['currency']) {
  const r = RECIPE_BY_ID[recipeId];
  return r.ingredients
    .filter((i) => INGREDIENTS[i.key].swap)
    .map((i) => {
      const ing = INGREDIENTS[i.key];
      const saving = i.use * ing.price * ing.swap!.saveFraction * PRICE_FACTOR[currency];
      return { key: i.key, from: ing.name, to: ing.swap!.name, label: ing.swap!.label, saving };
    });
}

export function allSwapKeys(recipeId: string) {
  return RECIPE_BY_ID[recipeId].ingredients.filter((i) => INGREDIENTS[i.key].swap).map((i) => i.key);
}

function mealsOf(day: PlanDay) {
  return [...MEAL_SLOTS.map((s) => day.slots[s]), ...day.snacks.map((id) => ({ recipeId: id, swaps: [] as string[] }))];
}

export function dayNutrition(day: PlanDay) {
  return mealsOf(day).reduce(
    (acc, m) => {
      const r = RECIPE_BY_ID[m.recipeId];
      return { kcal: acc.kcal + r.kcal, protein: acc.protein + r.protein };
    },
    { kcal: 0, protein: 0 },
  );
}

/** Consolidated grocery list: Σ ingredients − pantry credits, rounded up to whole packs. */
export function buildGroceryList(days: PlanDay[], householdSize: number, pantry: string[], currency: Profile['currency']): GroceryItem[] {
  // One entry per ingredient so packs are shared across meals; the cheaper variant is
  // bought when most of the week's use has the swap applied.
  const map = new Map<string, { key: string; swappedUse: number; use: number; usedIn: Set<number> }>();
  days.forEach((day, di) => {
    mealsOf(day).forEach((m) => {
      RECIPE_BY_ID[m.recipeId].ingredients.forEach((i) => {
        const entry = map.get(i.key) ?? { key: i.key, swappedUse: 0, use: 0, usedIn: new Set<number>() };
        entry.use += i.use * householdSize;
        if (m.swaps.includes(i.key) && INGREDIENTS[i.key].swap) entry.swappedUse += i.use * householdSize;
        entry.usedIn.add(di);
        map.set(i.key, entry);
      });
    });
  });
  const items: GroceryItem[] = [];
  map.forEach((raw) => {
    const e = { ...raw, swapped: raw.swappedUse > 0 && raw.swappedUse >= raw.use / 2 };
    const id = e.swapped ? `${e.key}~swap` : e.key;
    const ing = INGREDIENTS[e.key];
    const packsNeeded = Math.max(1, Math.ceil(e.use - 0.001));
    const inPantry = pantry.includes(e.key) || !!ing.staple;
    const packs = inPantry ? Math.max(0, packsNeeded - 1) : packsNeeded;
    const name = e.swapped ? ing.swap!.name : ing.name;
    items.push({
      id,
      key: e.key,
      name,
      aisle: ing.aisle,
      qty: packs === 0 ? 'In pantry' : e.swapped ? `${packs} pack${packs > 1 ? 's' : ''}` : `${packs} × ${ing.pack}`,
      packs,
      estPrice: packs * unitPrice(e.key, e.swapped, currency),
      usedIn: [...e.usedIn].sort(),
      pantryCredit: inPantry,
    });
  });
  const aisleOrder: Aisle[] = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen'];
  return items.sort((a, b) => aisleOrder.indexOf(a.aisle) - aisleOrder.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

export function planCost(days: PlanDay[], householdSize: number, pantry: string[], currency: Profile['currency']) {
  return buildGroceryList(days, householdSize, pantry, currency).reduce((s, i) => s + i.estPrice, 0);
}

export function estimateRange(mid: number): [number, number] {
  return [mid * (1 - ESTIMATE_SPREAD), mid * (1 + ESTIMATE_SPREAD)];
}

/** Keep batch-cook links consistent after edits. */
export function relinkBatches(days: PlanDay[]) {
  days.forEach((day, d) => {
    const lunch = day.slots.lunch;
    if (lunch.leftoverOf !== undefined) {
      const src = days[lunch.leftoverOf]?.slots.dinner;
      if (!src || src.recipeId !== lunch.recipeId) {
        lunch.leftoverOf = undefined;
        lunch.batchNote = undefined;
      }
    }
    const next = days[d + 1]?.slots.lunch;
    const dinner = day.slots.dinner;
    dinner.batchNote = next && next.leftoverOf === d ? `Cook once, covers ${DAY_LONG[weekday(days[d + 1].date)]}'s lunch` : undefined;
  });
  return days;
}

type Scored = { days: PlanDay[]; cost: number; penalty: number };

function buildCandidate(input: PlannerInput, pools: Record<MealSlot | 'snack', Recipe[]>, rng: () => number, costWeight: number): PlanDay[] {
  const { profile, mode, tried, locked, exclude } = input;
  const days: PlanDay[] = [];
  let newCount = 0;
  const target = profile.calorieTarget;
  const hh = profile.householdSize;

  // Packs opened so far this week: favour recipes that finish what's already bought
  const opened = new Map<string, number>();
  const credited = (key: string) => input.pantry.includes(key) || !!INGREDIENTS[key].staple;
  const consume = (recipeId: string) => RECIPE_BY_ID[recipeId].ingredients.forEach((i) => opened.set(i.key, (opened.get(i.key) ?? 0) + i.use * hh));
  const marginalCost = (r: Recipe, swaps: string[]) =>
    r.ingredients.reduce((sum, i) => {
      if (credited(i.key)) return sum;
      const used = opened.get(i.key) ?? 0;
      const packs = Math.ceil(used + i.use * hh - 0.001) - Math.ceil(used - 0.001);
      const ing = INGREDIENTS[i.key];
      return sum + packs * ing.price * (swaps.includes(i.key) && ing.swap ? 1 - ing.swap.saveFraction : 1);
    }, 0);

  for (let d = 0; d < 7; d++) {
    const date = addDays(input.weekStart, d);
    const slots = {} as Record<MealSlot, PlannedMeal>;
    for (const slot of MEAL_SLOTS) {
      const keep = locked?.(d, slot);
      if (keep) {
        slots[slot] = { ...keep, swaps: [...keep.swaps] };
        if (!tried.includes(keep.recipeId)) newCount++;
        consume(keep.recipeId);
        continue;
      }
      const prevDinner = days[d - 1]?.slots.dinner;
      const prevRecipe = prevDinner ? RECIPE_BY_ID[prevDinner.recipeId] : undefined;
      const leftoverAllowed = !(exclude && exclude.day === d && exclude.slot === slot && prevDinner?.recipeId === exclude.recipeId);
      if (slot === 'lunch' && prevRecipe?.batch && leftoverAllowed && rng() < 0.75) {
        slots.lunch = { recipeId: prevRecipe.id, swaps: [...prevDinner!.swaps], leftoverOf: d - 1 };
        consume(prevRecipe.id);
        continue;
      }
      const recent = days.slice(Math.max(0, d - 3));
      let best: Recipe | undefined;
      let bestScore = Infinity;
      for (const r of pools[slot]) {
        if (exclude && exclude.day === d && exclude.slot === slot && exclude.recipeId === r.id) continue;
        const swaps = mode === 'budget_light' ? allSwapKeys(r.id) : [];
        const share = (servingCost(r.id, swaps, profile.currency) / PRICE_FACTOR[profile.currency]) * hh;
        let score = (share * 0.5 + marginalCost(r, swaps) * 0.5) * costWeight * 0.5;
        if (recent.some((pd) => MEAL_SLOTS.some((s) => pd.slots[s].recipeId === r.id && pd.slots[s].leftoverOf === undefined))) score += 60;
        if (slot !== 'breakfast' && recent.some((pd) => RECIPE_BY_ID[pd.slots[slot].recipeId].mainProtein === r.mainProtein)) score += 18;
        if (!tried.includes(r.id) && newCount >= MAX_NEW_PER_WEEK) score += 45;
        score += rng() * 22;
        if (score < bestScore) {
          bestScore = score;
          best = r;
        }
      }
      const pick = best ?? pools[slot][0];
      if (!tried.includes(pick.id)) newCount++;
      consume(pick.id);
      slots[slot] = { recipeId: pick.id, swaps: mode === 'budget_light' ? allSwapKeys(pick.id) : [] };
    }
    const day: PlanDay = { date, slots, snacks: [] };
    let kcal = dayNutrition(day).kcal;
    // Snacks top up calories, preferring ones that use packs already opened
    const snackPool = [...pools.snack].sort((a, b) => marginalCost(a, []) - marginalCost(b, []) + (rng() - 0.5) * 20);
    for (const s of snackPool) {
      if (kcal >= target * 0.92 || day.snacks.length >= MAX_SNACKS) break;
      if (kcal + s.kcal > target * 1.1) continue;
      day.snacks.push(s.id);
      consume(s.id);
      kcal += s.kcal;
    }
    days.push(day);
  }
  return relinkBatches(days);
}

function evaluate(days: PlanDay[], input: PlannerInput, costWeight: number): Scored {
  const { profile, ceiling, pantry, tried } = input;
  const cost = planCost(days, profile.householdSize, pantry, profile.currency);
  let penalty = Math.max(0, cost - ceiling) * 4 / PRICE_FACTOR[profile.currency];
  const lo = profile.calorieTarget * 0.9;
  const hi = profile.calorieTarget * 1.1;
  days.forEach((day) => {
    const n = dayNutrition(day);
    if (n.kcal < lo) penalty += 40 + (lo - n.kcal) * 0.2;
    if (n.kcal > hi) penalty += 30;
    if (n.protein < PROTEIN_FLOOR_G) penalty += 40;
  });
  const fresh = new Set(days.flatMap((d) => MEAL_SLOTS.map((s) => d.slots[s].recipeId)).filter((id) => !tried.includes(id)));
  penalty += Math.max(0, fresh.size - MAX_NEW_PER_WEEK) * 25;
  // Variety: no repeated dish or main protein within 4 days (leftovers excepted)
  days.forEach((day, d) => {
    const window = days.slice(Math.max(0, d - 3), d);
    MEAL_SLOTS.forEach((slot) => {
      const m = day.slots[slot];
      if (m.leftoverOf !== undefined) return;
      if (window.some((w) => MEAL_SLOTS.some((s) => w.slots[s].recipeId === m.recipeId && w.slots[s].leftoverOf === undefined))) penalty += 30;
      if (slot === 'dinner' && window.some((w) => RECIPE_BY_ID[w.slots.dinner.recipeId].mainProtein === RECIPE_BY_ID[m.recipeId].mainProtein)) penalty += 12;
    });
  });
  const distinctDinners = new Set(days.map((d) => d.slots.dinner.recipeId)).size;
  penalty += Math.max(0, 5 - distinctDinners) * 45;
  penalty += (cost / PRICE_FACTOR[profile.currency]) * costWeight * 0.1;
  return { days, cost, penalty };
}

function pools(profile: PlannerProfile) {
  const byslot = (slot: MealSlot | 'snack') => {
    const strict = RECIPES.filter((r) => r.slot === slot && eligible(r, profile));
    return strict.length ? strict : RECIPES.filter((r) => r.slot === slot && eligible(r, profile, true));
  };
  return { breakfast: byslot('breakfast'), lunch: byslot('lunch'), dinner: byslot('dinner'), snack: byslot('snack') };
}

function search(input: PlannerInput, costWeight: number, iterations: number): Scored {
  const rng = mulberry32(input.seed);
  const p = pools(input.profile);
  let best: Scored | undefined;
  for (let i = 0; i < iterations; i++) {
    const cand = evaluate(buildCandidate(input, p, rng, costWeight), input, costWeight);
    if (!best || cand.penalty < best.penalty) best = cand;
  }
  return best!;
}

export function hasRecipesFor(profile: PlannerProfile) {
  const p = pools(profile);
  return MEAL_SLOTS.every((s) => p[s].length > 0);
}

export function generatePlan(input: PlannerInput): MealPlan {
  const iterations = input.iterations ?? 140;
  const costWeight = input.mode === 'budget_light' ? 1.6 : 0.5;
  let result = search(input, costWeight, iterations);
  let status: MealPlan['status'] = 'ok';
  let shortfall = 0;
  if (result.cost > input.ceiling) {
    // Over budget: try a budget-light week that keeps variety, then the cheapest week
    // that still meets the nutrition floor. Budget outranks variety; nutrition outranks budget.
    const balanced = search({ ...input, mode: 'budget_light', seed: input.seed + 7 }, 2.5, iterations);
    if (balanced.cost <= input.ceiling) result = balanced;
    else {
      const floor = search({ ...input, mode: 'budget_light', seed: input.seed + 13 }, 6, iterations);
      result = floor.cost < balanced.cost ? floor : balanced;
      if (result.cost > input.ceiling) {
        status = 'budget_floor_conflict';
        shortfall = Math.ceil(result.cost - input.ceiling);
      }
    }
  }
  return {
    weekStart: input.weekStart,
    days: result.days,
    ceiling: input.ceiling,
    mode: input.mode,
    status,
    shortfall,
    generatedAt: new Date().toISOString(),
    seed: input.seed,
  };
}

/** Regenerate one meal, keeping every other slot and the budget/calorie constraints. */
export function regenerateSlot(plan: MealPlan, input: Omit<PlannerInput, 'locked' | 'exclude' | 'weekStart' | 'seed'>, day: number, slot: MealSlot) {
  const current = plan.days[day].slots[slot];
  const unlockNextLunch = slot === 'dinner' && plan.days[day + 1]?.slots.lunch.leftoverOf === day;
  return generatePlan({
    ...input,
    weekStart: plan.weekStart,
    seed: plan.seed + day * 31 + MEAL_SLOTS.indexOf(slot) + Date.now() % 997,
    iterations: 60,
    exclude: { day, slot, recipeId: current.recipeId },
    locked: (d, s) => {
      if (d === day && s === slot) return undefined;
      if (unlockNextLunch && d === day + 1 && s === 'lunch') return undefined;
      return plan.days[d].slots[s];
    },
  });
}

export function regenerateDay(plan: MealPlan, input: Omit<PlannerInput, 'locked' | 'exclude' | 'weekStart' | 'seed'>, day: number) {
  const unlockNextLunch = plan.days[day + 1]?.slots.lunch.leftoverOf === day;
  return generatePlan({
    ...input,
    weekStart: plan.weekStart,
    seed: plan.seed + day * 101 + Date.now() % 997,
    iterations: 80,
    exclude: { day, slot: 'dinner', recipeId: plan.days[day].slots.dinner.recipeId },
    locked: (d, s) => {
      if (d === day) return undefined;
      if (unlockNextLunch && d === day + 1 && s === 'lunch') return undefined;
      return plan.days[d].slots[s];
    },
  });
}
