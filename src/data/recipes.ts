import type { Allergen, MealSlot } from '@/store/types';

/** `Other` holds the per-serving cost of user meals priced by the user, not by pack. */
export type Aisle = 'Produce' | 'Meat & fish' | 'Dairy & eggs' | 'Bakery' | 'Pantry' | 'Frozen' | 'Other';

export type Ingredient = {
  name: string;
  pack: string;
  price: number; // ZAR per pack (regional base price)
  aisle: Aisle;
  staple?: boolean; // assumed in most pantries
  perishable?: boolean;
  swap?: { name: string; saveFraction: number; label: string };
};

// Base regional price list (South Africa, ZAR). Other currencies are scaled in lib/format.
export const INGREDIENTS: Record<string, Ingredient> = {
  oats: { name: 'Rolled oats', pack: '1 kg', price: 45, aisle: 'Pantry', swap: { name: 'Store-brand oats', saveFraction: 0.3, label: 'Store-brand oats' } },
  milk: { name: 'Milk', pack: '2 L', price: 38, aisle: 'Dairy & eggs', perishable: true },
  eggs: { name: 'Eggs', pack: '18 pack', price: 75, aisle: 'Dairy & eggs' },
  bread: { name: 'Brown bread', pack: '1 loaf', price: 22, aisle: 'Bakery', perishable: true },
  bananas: { name: 'Bananas', pack: '1 kg', price: 28, aisle: 'Produce', perishable: true },
  peanut_butter: { name: 'Peanut butter', pack: '400 g', price: 45, aisle: 'Pantry', swap: { name: 'Store-brand peanut butter', saveFraction: 0.35, label: 'Store-brand peanut butter' } },
  yoghurt: { name: 'Plain yoghurt', pack: '1 kg', price: 42, aisle: 'Dairy & eggs', perishable: true, swap: { name: 'Store-brand yoghurt', saveFraction: 0.3, label: 'Store-brand yoghurt' } },
  maize_meal: { name: 'Maize meal', pack: '2.5 kg', price: 42, aisle: 'Pantry' },
  rice: { name: 'Rice', pack: '2 kg', price: 45, aisle: 'Pantry' },
  pasta: { name: 'Pasta', pack: '500 g', price: 22, aisle: 'Pantry', swap: { name: 'Store-brand pasta', saveFraction: 0.35, label: 'Store-brand pasta' } },
  chicken_breast: { name: 'Chicken breasts', pack: '1 kg', price: 110, aisle: 'Meat & fish', perishable: true, swap: { name: 'Chicken thighs (deboned)', saveFraction: 0.3, label: 'Thighs instead of breasts' } },
  chicken_thighs: { name: 'Chicken thighs', pack: '1 kg', price: 75, aisle: 'Meat & fish', perishable: true, swap: { name: 'Frozen chicken thighs', saveFraction: 0.2, label: 'Frozen instead of fresh' } },
  beef_mince: { name: 'Beef mince', pack: '500 g', price: 70, aisle: 'Meat & fish', perishable: true, swap: { name: 'Half mince, half lentils', saveFraction: 0.4, label: 'Stretch mince with lentils' } },
  soya_mince: { name: 'Soya mince', pack: '400 g', price: 25, aisle: 'Pantry' },
  lentils: { name: 'Red lentils', pack: '500 g', price: 30, aisle: 'Pantry' },
  beans_can: { name: 'Butter beans', pack: '1 tin', price: 17, aisle: 'Pantry' },
  chickpeas: { name: 'Chickpeas', pack: '1 tin', price: 19, aisle: 'Pantry' },
  tuna: { name: 'Tuna', pack: '1 tin', price: 28, aisle: 'Pantry', swap: { name: 'Pilchards', saveFraction: 0.3, label: 'Pilchards instead of tuna' } },
  pilchards: { name: 'Pilchards in tomato', pack: '400 g tin', price: 30, aisle: 'Pantry' },
  hake: { name: 'Frozen hake', pack: '800 g', price: 95, aisle: 'Frozen' },
  tofu: { name: 'Firm tofu', pack: '300 g', price: 40, aisle: 'Dairy & eggs', perishable: true },
  cabbage: { name: 'Cabbage', pack: '1 head', price: 22, aisle: 'Produce' },
  spinach: { name: 'Spinach', pack: '1 bunch', price: 20, aisle: 'Produce', perishable: true, swap: { name: 'Frozen spinach', saveFraction: 0.25, label: 'Frozen instead of fresh' } },
  tomatoes: { name: 'Tomatoes', pack: '1 kg', price: 30, aisle: 'Produce', perishable: true, swap: { name: 'Tinned chopped tomatoes', saveFraction: 0.35, label: 'Tinned instead of fresh' } },
  onions: { name: 'Onions', pack: '2 kg', price: 35, aisle: 'Produce' },
  carrots: { name: 'Carrots', pack: '1 kg', price: 20, aisle: 'Produce' },
  potatoes: { name: 'Potatoes', pack: '2 kg', price: 40, aisle: 'Produce' },
  sweet_potato: { name: 'Sweet potatoes', pack: '1 kg', price: 30, aisle: 'Produce' },
  butternut: { name: 'Butternut', pack: '1 whole', price: 25, aisle: 'Produce' },
  peppers: { name: 'Peppers', pack: '3 pack', price: 30, aisle: 'Produce', perishable: true, swap: { name: 'Frozen mixed peppers', saveFraction: 0.3, label: 'Frozen instead of fresh' } },
  mixed_veg: { name: 'Frozen mixed veg', pack: '1 kg', price: 40, aisle: 'Frozen' },
  cheese: { name: 'Cheddar', pack: '400 g', price: 70, aisle: 'Dairy & eggs', swap: { name: 'Store-brand cheddar', saveFraction: 0.3, label: 'Store-brand cheddar' } },
  tortillas: { name: 'Wraps', pack: '6 pack', price: 35, aisle: 'Bakery', swap: { name: 'Store-brand wraps', saveFraction: 0.3, label: 'Store-brand wraps' } },
  noodles: { name: 'Egg noodles', pack: '250 g', price: 18, aisle: 'Pantry' },
  coconut_milk: { name: 'Coconut milk', pack: '1 tin', price: 25, aisle: 'Pantry' },
  avocado: { name: 'Avocados', pack: '4 pack', price: 40, aisle: 'Produce', perishable: true },
  apples: { name: 'Apples', pack: '1.5 kg', price: 30, aisle: 'Produce' },
  herbs: { name: 'Fresh coriander', pack: '1 bunch', price: 15, aisle: 'Produce', perishable: true },
  samp_beans: { name: 'Samp & beans', pack: '1 kg', price: 30, aisle: 'Pantry' },
  oil: { name: 'Sunflower oil', pack: '750 ml', price: 35, aisle: 'Pantry', staple: true },
  spice: { name: 'Curry spice', pack: '50 g', price: 20, aisle: 'Pantry', staple: true },
  stock: { name: 'Stock cubes', pack: '12 pack', price: 15, aisle: 'Pantry', staple: true },
  garlic: { name: 'Garlic', pack: '3 heads', price: 18, aisle: 'Produce', staple: true },
};

export type Recipe = {
  id: string;
  name: string;
  emoji: string;
  tint: 'green' | 'amber' | 'blue' | 'red';
  slot: MealSlot | 'snack';
  kcal: number; // per serving
  protein: number; // g per serving
  minutes: number;
  meat: 'none' | 'fish' | 'poultry' | 'red';
  vegan: boolean;
  dairy: boolean;
  allergens: Allergen[];
  mainProtein: string;
  batch?: boolean; // cook once, covers next day's lunch
  classic?: boolean; // familiar to most households (doesn't count as "new")
  ingredients: { key: string; use: number }[]; // fraction of a pack per serving
  steps: string[];
  /** Where the recipe comes from; built-ins omit it. See src/lib/catalog.ts. */
  source?: 'builtin' | 'custom' | 'edited';
  /** The `UserMeal.id` behind a custom or edited recipe. */
  userMealId?: string;
  /** Free-text ingredients of a user-priced meal (shown instead of pack ingredients). */
  customIngredients?: { name: string; qty?: number | null; unit?: string | null }[];
  notes?: string;
  image?: { url: string; thumbUrl?: string | null; photographer?: string | null; photographerUrl?: string | null; sourceUrl?: string | null; provider?: string | null } | null;
};

export const RECIPES: Recipe[] = [
  // Breakfasts
  { id: 'b_oats', name: 'Banana peanut-butter oats', emoji: '🥣', tint: 'amber', slot: 'breakfast', kcal: 450, protein: 15, minutes: 10, meat: 'none', vegan: false, dairy: true, allergens: ['nuts', 'dairy'], mainProtein: 'oats', classic: true,
    ingredients: [{ key: 'oats', use: 0.08 }, { key: 'milk', use: 0.12 }, { key: 'bananas', use: 0.12 }, { key: 'peanut_butter', use: 0.05 }],
    steps: ['Simmer oats in milk for 5 minutes.', 'Slice banana on top.', 'Swirl in a spoon of peanut butter.'] },
  { id: 'b_eggs_toast', name: 'Scrambled eggs on toast', emoji: '🍳', tint: 'amber', slot: 'breakfast', kcal: 420, protein: 22, minutes: 10, meat: 'none', vegan: false, dairy: true, allergens: ['eggs', 'gluten', 'dairy'], mainProtein: 'eggs', classic: true,
    ingredients: [{ key: 'eggs', use: 0.12 }, { key: 'bread', use: 0.12 }, { key: 'milk', use: 0.02 }],
    steps: ['Whisk eggs with a splash of milk.', 'Cook gently, stirring, until just set.', 'Serve on toast.'] },
  { id: 'b_yoghurt', name: 'Yoghurt, oats & apple bowl', emoji: '🍎', tint: 'green', slot: 'breakfast', kcal: 380, protein: 16, minutes: 5, meat: 'none', vegan: false, dairy: true, allergens: ['dairy'], mainProtein: 'yoghurt', classic: true,
    ingredients: [{ key: 'yoghurt', use: 0.2 }, { key: 'oats', use: 0.05 }, { key: 'apples', use: 0.1 }],
    steps: ['Spoon yoghurt into a bowl.', 'Top with oats and chopped apple.'] },
  { id: 'b_pap', name: 'Soft maize porridge with banana', emoji: '🌽', tint: 'amber', slot: 'breakfast', kcal: 400, protein: 11, minutes: 15, meat: 'none', vegan: false, dairy: true, allergens: ['dairy'], mainProtein: 'maize', classic: true,
    ingredients: [{ key: 'maize_meal', use: 0.03 }, { key: 'milk', use: 0.1 }, { key: 'bananas', use: 0.1 }],
    steps: ['Whisk maize meal into boiling water.', 'Cook 10 minutes, stirring.', 'Serve with milk and sliced banana.'] },
  { id: 'b_avo_toast', name: 'Avo & tomato toast', emoji: '🥑', tint: 'green', slot: 'breakfast', kcal: 390, protein: 10, minutes: 5, meat: 'none', vegan: true, dairy: false, allergens: ['gluten'], mainProtein: 'avocado',
    ingredients: [{ key: 'bread', use: 0.12 }, { key: 'avocado', use: 0.25 }, { key: 'tomatoes', use: 0.06 }],
    steps: ['Toast the bread.', 'Mash avo with salt and lemon.', 'Top with sliced tomato.'] },
  { id: 'b_pb_toast', name: 'Peanut butter & banana toast', emoji: '🍌', tint: 'amber', slot: 'breakfast', kcal: 430, protein: 14, minutes: 5, meat: 'none', vegan: true, dairy: false, allergens: ['gluten', 'nuts'], mainProtein: 'peanut', classic: true,
    ingredients: [{ key: 'bread', use: 0.12 }, { key: 'peanut_butter', use: 0.05 }, { key: 'bananas', use: 0.12 }],
    steps: ['Toast the bread.', 'Spread peanut butter.', 'Top with banana slices.'] },
  { id: 'b_oats_plain', name: 'Apple-cinnamon oats', emoji: '🥣', tint: 'green', slot: 'breakfast', kcal: 360, protein: 10, minutes: 10, meat: 'none', vegan: true, dairy: false, allergens: [], mainProtein: 'oats',
    ingredients: [{ key: 'oats', use: 0.08 }, { key: 'apples', use: 0.1 }],
    steps: ['Simmer oats in water with grated apple.', 'Finish with cinnamon.'] },

  // Lunches
  { id: 'l_tuna_wrap', name: 'Tuna & pepper wrap', emoji: '🌯', tint: 'blue', slot: 'lunch', kcal: 520, protein: 30, minutes: 10, meat: 'fish', vegan: false, dairy: false, allergens: ['gluten', 'fish'], mainProtein: 'fish', classic: true,
    ingredients: [{ key: 'tortillas', use: 0.34 }, { key: 'tuna', use: 0.5 }, { key: 'peppers', use: 0.15 }, { key: 'tomatoes', use: 0.04 }],
    steps: ['Flake tuna and mix with chopped pepper and tomato.', 'Roll into wraps.'] },
  { id: 'l_lentil_soup', name: 'Red lentil & carrot soup', emoji: '🥕', tint: 'amber', slot: 'lunch', kcal: 480, protein: 22, minutes: 30, meat: 'none', vegan: true, dairy: false, allergens: ['gluten'], mainProtein: 'lentils',
    ingredients: [{ key: 'lentils', use: 0.18 }, { key: 'carrots', use: 0.12 }, { key: 'onions', use: 0.04 }, { key: 'stock', use: 0.08 }, { key: 'bread', use: 0.08 }],
    steps: ['Soften onion and carrot.', 'Add lentils and stock; simmer 20 minutes.', 'Blend roughly and serve with bread.'] },
  { id: 'l_chickpea_salad', name: 'Chickpea & roast pepper salad', emoji: '🥗', tint: 'green', slot: 'lunch', kcal: 450, protein: 17, minutes: 20, meat: 'none', vegan: true, dairy: false, allergens: [], mainProtein: 'chickpeas',
    ingredients: [{ key: 'chickpeas', use: 0.5 }, { key: 'peppers', use: 0.33 }, { key: 'tomatoes', use: 0.06 }, { key: 'herbs', use: 0.25 }],
    steps: ['Roast peppers until soft.', 'Toss with chickpeas, tomato and coriander.'] },
  { id: 'l_egg_rice', name: 'Egg fried rice with veg', emoji: '🍚', tint: 'amber', slot: 'lunch', kcal: 560, protein: 20, minutes: 20, meat: 'none', vegan: false, dairy: false, allergens: ['eggs', 'soy'], mainProtein: 'eggs', classic: true,
    ingredients: [{ key: 'rice', use: 0.05 }, { key: 'eggs', use: 0.11 }, { key: 'mixed_veg', use: 0.12 }, { key: 'oil', use: 0.02 }],
    steps: ['Cook rice (or use leftover rice).', 'Stir-fry veg, push aside, scramble eggs.', 'Toss everything with soy sauce.'] },
  { id: 'l_quesadilla', name: 'Butter bean & cheese quesadilla', emoji: '🫓', tint: 'amber', slot: 'lunch', kcal: 600, protein: 24, minutes: 15, meat: 'none', vegan: false, dairy: true, allergens: ['gluten', 'dairy'], mainProtein: 'beans',
    ingredients: [{ key: 'tortillas', use: 0.34 }, { key: 'beans_can', use: 0.5 }, { key: 'cheese', use: 0.08 }],
    steps: ['Mash beans with spices.', 'Fill wraps with beans and cheese.', 'Toast in a dry pan until golden.'] },
  { id: 'l_pilchards', name: 'Pilchards on toast with onion', emoji: '🐟', tint: 'blue', slot: 'lunch', kcal: 500, protein: 30, minutes: 10, meat: 'fish', vegan: false, dairy: false, allergens: ['gluten', 'fish'], mainProtein: 'fish', classic: true,
    ingredients: [{ key: 'pilchards', use: 0.5 }, { key: 'bread', use: 0.12 }, { key: 'onions', use: 0.03 }],
    steps: ['Warm pilchards with sliced onion.', 'Serve on toast.'] },
  { id: 'l_chicken_wrap', name: 'Chicken & avo wrap', emoji: '🌮', tint: 'green', slot: 'lunch', kcal: 580, protein: 35, minutes: 20, meat: 'poultry', vegan: false, dairy: false, allergens: ['gluten'], mainProtein: 'chicken', classic: true,
    ingredients: [{ key: 'tortillas', use: 0.34 }, { key: 'chicken_breast', use: 0.12 }, { key: 'avocado', use: 0.25 }],
    steps: ['Pan-fry seasoned chicken strips.', 'Fill wraps with chicken and sliced avo.'] },
  { id: 'l_sweet_potato', name: 'Roast sweet potato & bean bowl', emoji: '🍠', tint: 'amber', slot: 'lunch', kcal: 520, protein: 18, minutes: 35, meat: 'none', vegan: true, dairy: false, allergens: [], mainProtein: 'beans',
    ingredients: [{ key: 'sweet_potato', use: 0.25 }, { key: 'beans_can', use: 0.5 }, { key: 'spinach', use: 0.25 }],
    steps: ['Roast sweet potato cubes 25 minutes.', 'Warm beans, wilt spinach.', 'Combine in a bowl.'] },

  // Dinners
  { id: 'd_chicken_stew', name: 'Chicken thigh & veg stew', emoji: '🍲', tint: 'amber', slot: 'dinner', kcal: 680, protein: 40, minutes: 45, meat: 'poultry', vegan: false, dairy: false, allergens: [], mainProtein: 'chicken', batch: true, classic: true,
    ingredients: [{ key: 'chicken_thighs', use: 0.2 }, { key: 'potatoes', use: 0.1 }, { key: 'carrots', use: 0.12 }, { key: 'onions', use: 0.04 }, { key: 'stock', use: 0.08 }],
    steps: ['Brown chicken thighs.', 'Add onion, carrot, potato and stock.', 'Simmer 35 minutes. Doubles easily for tomorrow.'] },
  { id: 'd_stirfry', name: 'Chicken stir-fry with noodles', emoji: '🥢', tint: 'red', slot: 'dinner', kcal: 650, protein: 42, minutes: 25, meat: 'poultry', vegan: false, dairy: false, allergens: ['gluten', 'eggs', 'soy'], mainProtein: 'chicken',
    ingredients: [{ key: 'chicken_breast', use: 0.15 }, { key: 'noodles', use: 0.35 }, { key: 'peppers', use: 0.33 }, { key: 'mixed_veg', use: 0.1 }],
    steps: ['Cook noodles.', 'Stir-fry chicken, then peppers and veg.', 'Toss with noodles and soy sauce.'] },
  { id: 'd_bolognaise', name: 'Beef mince bolognaise', emoji: '🍝', tint: 'red', slot: 'dinner', kcal: 720, protein: 38, minutes: 35, meat: 'red', vegan: false, dairy: false, allergens: ['gluten'], mainProtein: 'beef', batch: true, classic: true,
    ingredients: [{ key: 'beef_mince', use: 0.25 }, { key: 'pasta', use: 0.25 }, { key: 'tomatoes', use: 0.12 }, { key: 'onions', use: 0.04 }, { key: 'garlic', use: 0.05 }],
    steps: ['Brown mince with onion and garlic.', 'Add tomatoes; simmer 20 minutes.', 'Serve over pasta.'] },
  { id: 'd_cottage_pie', name: 'Cottage pie with cabbage', emoji: '🥧', tint: 'amber', slot: 'dinner', kcal: 700, protein: 34, minutes: 50, meat: 'red', vegan: false, dairy: true, allergens: ['dairy'], mainProtein: 'beef', batch: true,
    ingredients: [{ key: 'beef_mince', use: 0.25 }, { key: 'potatoes', use: 0.15 }, { key: 'cabbage', use: 0.2 }, { key: 'milk', use: 0.03 }],
    steps: ['Cook mince with onion.', 'Top with mashed potato.', 'Bake 25 minutes; serve with buttered cabbage.'] },
  { id: 'd_lentil_curry', name: 'Lentil & butternut curry', emoji: '🍛', tint: 'amber', slot: 'dinner', kcal: 640, protein: 24, minutes: 40, meat: 'none', vegan: true, dairy: false, allergens: [], mainProtein: 'lentils', batch: true,
    ingredients: [{ key: 'lentils', use: 0.2 }, { key: 'butternut', use: 0.25 }, { key: 'coconut_milk', use: 0.5 }, { key: 'rice', use: 0.05 }, { key: 'spice', use: 0.1 }],
    steps: ['Fry spices, add butternut and lentils.', 'Pour in coconut milk and water; simmer 25 minutes.', 'Serve with rice.'] },
  { id: 'd_hake', name: 'Oven hake, wedges & slaw', emoji: '🐟', tint: 'blue', slot: 'dinner', kcal: 620, protein: 36, minutes: 35, meat: 'fish', vegan: false, dairy: false, allergens: ['fish'], mainProtein: 'fish', classic: true,
    ingredients: [{ key: 'hake', use: 0.2 }, { key: 'potatoes', use: 0.12 }, { key: 'cabbage', use: 0.2 }],
    steps: ['Roast potato wedges 30 minutes.', 'Bake hake for the last 15 minutes.', 'Shred cabbage into a quick slaw.'] },
  { id: 'd_tofu', name: 'Tofu & veg stir-fry with rice', emoji: '🥡', tint: 'green', slot: 'dinner', kcal: 600, protein: 26, minutes: 25, meat: 'none', vegan: true, dairy: false, allergens: ['soy'], mainProtein: 'tofu',
    ingredients: [{ key: 'tofu', use: 0.5 }, { key: 'rice', use: 0.05 }, { key: 'peppers', use: 0.33 }, { key: 'mixed_veg', use: 0.1 }],
    steps: ['Crisp cubed tofu in a hot pan.', 'Stir-fry veg.', 'Serve over rice.'] },
  { id: 'd_samp', name: 'Samp & beans with cabbage', emoji: '🫘', tint: 'amber', slot: 'dinner', kcal: 660, protein: 22, minutes: 60, meat: 'none', vegan: true, dairy: false, allergens: [], mainProtein: 'beans', batch: true, classic: true,
    ingredients: [{ key: 'samp_beans', use: 0.15 }, { key: 'cabbage', use: 0.2 }, { key: 'onions', use: 0.04 }, { key: 'tomatoes', use: 0.06 }],
    steps: ['Soak samp & beans overnight.', 'Simmer 50 minutes until tender.', 'Serve with braised cabbage and tomato.'] },
  { id: 'd_chilli', name: 'Bean chilli with rice', emoji: '🌶️', tint: 'red', slot: 'dinner', kcal: 630, protein: 24, minutes: 30, meat: 'none', vegan: true, dairy: false, allergens: [], mainProtein: 'beans', batch: true,
    ingredients: [{ key: 'beans_can', use: 0.5 }, { key: 'tomatoes', use: 0.12 }, { key: 'rice', use: 0.05 }, { key: 'peppers', use: 0.2 }, { key: 'onions', use: 0.04 }, { key: 'spice', use: 0.05 }],
    steps: ['Soften onion and pepper with spice.', 'Add beans and tomatoes; simmer 20 minutes.', 'Serve with rice.'] },
  { id: 'd_chicken_curry', name: 'Chicken curry with rice', emoji: '🍛', tint: 'amber', slot: 'dinner', kcal: 700, protein: 40, minutes: 40, meat: 'poultry', vegan: false, dairy: false, allergens: [], mainProtein: 'chicken', classic: true,
    ingredients: [{ key: 'chicken_thighs', use: 0.2 }, { key: 'rice', use: 0.05 }, { key: 'tomatoes', use: 0.1 }, { key: 'spice', use: 0.1 }, { key: 'onions', use: 0.04 }],
    steps: ['Fry onion and curry spice.', 'Add chicken and tomatoes; simmer 30 minutes.', 'Serve with rice.'] },
  { id: 'd_pasta_bake', name: 'Spinach & cheese pasta bake', emoji: '🧀', tint: 'green', slot: 'dinner', kcal: 680, protein: 26, minutes: 35, meat: 'none', vegan: false, dairy: true, allergens: ['gluten', 'dairy'], mainProtein: 'cheese',
    ingredients: [{ key: 'pasta', use: 0.25 }, { key: 'spinach', use: 0.4 }, { key: 'cheese', use: 0.1 }, { key: 'milk', use: 0.04 }],
    steps: ['Cook pasta.', 'Stir through wilted spinach, milk and cheese.', 'Bake 15 minutes until bubbling.'] },
  { id: 'd_shakshuka', name: 'Shakshuka with bread', emoji: '🍅', tint: 'red', slot: 'dinner', kcal: 560, protein: 24, minutes: 25, meat: 'none', vegan: false, dairy: false, allergens: ['eggs', 'gluten'], mainProtein: 'eggs',
    ingredients: [{ key: 'eggs', use: 0.12 }, { key: 'tomatoes', use: 0.2 }, { key: 'peppers', use: 0.33 }, { key: 'bread', use: 0.12 }],
    steps: ['Simmer peppers and tomatoes into a sauce.', 'Crack in eggs; cover until set.', 'Serve with bread.'] },
  { id: 'd_pap_mince', name: 'Pap, chakalaka & mince', emoji: '🌽', tint: 'amber', slot: 'dinner', kcal: 720, protein: 32, minutes: 40, meat: 'red', vegan: false, dairy: false, allergens: [], mainProtein: 'beef', classic: true,
    ingredients: [{ key: 'maize_meal', use: 0.05 }, { key: 'beef_mince', use: 0.2 }, { key: 'beans_can', use: 0.25 }, { key: 'carrots', use: 0.1 }, { key: 'peppers', use: 0.2 }],
    steps: ['Cook stiff pap.', 'Brown mince.', 'Make chakalaka with carrot, pepper and beans.'] },
  { id: 'd_soya_bolognaise', name: 'Soya mince bolognaise', emoji: '🍝', tint: 'green', slot: 'dinner', kcal: 640, protein: 32, minutes: 30, meat: 'none', vegan: true, dairy: false, allergens: ['gluten', 'soy'], mainProtein: 'soya', batch: true,
    ingredients: [{ key: 'soya_mince', use: 0.25 }, { key: 'pasta', use: 0.25 }, { key: 'tomatoes', use: 0.12 }, { key: 'onions', use: 0.04 }, { key: 'garlic', use: 0.05 }],
    steps: ['Soak soya mince in stock.', 'Cook with onion, garlic and tomatoes.', 'Serve over pasta.'] },

  // Snacks
  { id: 's_apple', name: 'Apple', emoji: '🍏', tint: 'green', slot: 'snack', kcal: 95, protein: 0, minutes: 0, meat: 'none', vegan: true, dairy: false, allergens: [], mainProtein: 'fruit', classic: true,
    ingredients: [{ key: 'apples', use: 0.1 }], steps: [] },
  { id: 's_yoghurt', name: 'Yoghurt cup', emoji: '🥛', tint: 'blue', slot: 'snack', kcal: 150, protein: 8, minutes: 0, meat: 'none', vegan: false, dairy: true, allergens: ['dairy'], mainProtein: 'yoghurt', classic: true,
    ingredients: [{ key: 'yoghurt', use: 0.15 }], steps: [] },
  { id: 's_eggs', name: 'Two boiled eggs', emoji: '🥚', tint: 'amber', slot: 'snack', kcal: 150, protein: 12, minutes: 10, meat: 'none', vegan: false, dairy: false, allergens: ['eggs'], mainProtein: 'eggs', classic: true,
    ingredients: [{ key: 'eggs', use: 0.11 }], steps: [] },
  { id: 's_pb_banana', name: 'Banana & peanut butter', emoji: '🍌', tint: 'amber', slot: 'snack', kcal: 200, protein: 5, minutes: 0, meat: 'none', vegan: true, dairy: false, allergens: ['nuts'], mainProtein: 'peanut', classic: true,
    ingredients: [{ key: 'bananas', use: 0.12 }, { key: 'peanut_butter', use: 0.03 }], steps: [] },
];

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
