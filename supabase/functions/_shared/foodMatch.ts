// Food photo matching shared by the Edge Functions (pure: no Deno or Node APIs, unit-tested
// under Node). Keep `mealImageKey` identical to the client copy in src/lib/foodImages.ts.

export const MAX_MEAL_NAME = 80;

export function mealImageKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MEAL_NAME);
}

/** Words that say nothing about which dish a photo shows (including cooking methods). */
const STOP_WORDS = new Set([
  'and', 'with', 'the', 'for', 'from', 'food', 'meal', 'dish', 'style', 'easy', 'quick', 'simple', 'homemade', 'one', 'pot', 'pan', 'tray', 'sheet', 'bowl', 'cup', 'plate',
  'roast', 'roasted', 'baked', 'grilled', 'fried', 'toasted', 'steamed', 'stewed', 'braised', 'leftover', 'leftovers', 'batch',
]);

/** Local spellings → the spelling Pixabay's (mostly US English) tags use. */
const SPELLINGS: Record<string, string> = {
  bolognaise: 'bolognese',
  yoghurt: 'yogurt',
  yoghurts: 'yogurt',
  chilli: 'chili',
  chillies: 'chilies',
  courgette: 'zucchini',
  courgettes: 'zucchini',
  aubergine: 'eggplant',
  aubergines: 'eggplant',
  mielie: 'corn',
  mielies: 'corn',
  mince: 'minced',
  porridge: 'oatmeal',
};

/** Applies SPELLINGS word by word, keeping the rest of the text as-is. */
export function normalizeSpelling(text: string): string {
  return text.replace(/[A-Za-z]+/g, (w) => SPELLINGS[w.toLowerCase()] ?? w);
}

/**
 * Folds spelling and plural variants so "chilli"/"chili" and "beans"/"bean" compare equal:
 * local → Pixabay spelling, lowercase, strip accents, drop a plural "es"/"s", collapse doubled letters.
 */
export function stem(word: string): string {
  let w = mealImageKey(normalizeSpelling(word)).replace(/[^a-z]/g, '');
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ch|sh|x|o)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w.replace(/(.)\1+/g, '$1');
}

/** Distinct, meaningful stems of a meal name (stop words and words under 3 letters dropped). */
export function mealTerms(mealName: string): string[] {
  const terms = mealImageKey(mealName)
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(stem)
    .filter(Boolean);
  return [...new Set(terms)];
}

export const splitTags = (tags: string | undefined) =>
  (tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase().split(/\s+/).filter(Boolean).map(stem))
    .filter((words) => words.length > 0);

/**
 * How well a hit's tags describe the meal. Each meal term earns its best credit across tags:
 * 1 when it is a single-word tag or the head (last word) of a phrase tag ("chili" in "bean chili"),
 * 0.5 when it only modifies a phrase tag ("bean" in "bean sprouts").
 */
export function tagScore(terms: string[], tags: string | undefined): number {
  const parsed = splitTags(tags);
  let score = 0;
  for (const [i, term] of terms.entries()) {
    let credit = 0;
    for (const words of parsed) {
      if (words[words.length - 1] === term) credit = 1;
      else if (words.includes(term)) credit = Math.max(credit, 0.5);
      if (credit === 1) break;
    }
    score += credit * termWeight(i, terms.length);
  }
  return score;
}

/** The last meaningful word usually names the dish ("bolognaise", "chilli", "oats"), so it counts double. */
export function termWeight(index: number, count: number): number {
  return count > 1 && index === count - 1 ? 2 : 1;
}

/** Sum of all term weights: the score of a perfect match. */
export function maxScore(termCount: number): number {
  let total = 0;
  for (let i = 0; i < termCount; i++) total += termWeight(i, termCount);
  return total;
}

/**
 * Best usable photo for the meal, or null → emoji fallback.
 * Ranked by `tagScore`; ties go to the hit with fewer tags (long tag lists are usually SEO
 * filler), then to Pixabay's order. A hit must pass `isGoodMatch` (more than half the
 * perfect weighted score), so a photo matching one incidental word ("mince" → mince pies,
 * "bean" → coffee beans) never stands in for a meal; the emoji is shown instead. Without `mealName`, or when the name has no
 * meaningful terms, the first usable hit wins.
 */
/** A hit qualifies when it earns at least 1 point and strictly more than half the perfect score. */
export function isGoodMatch(score: number, termCount: number): boolean {
  return score >= 1 && score > maxScore(termCount) / 2;
}

/**
 * Best candidate for a name, or null. Candidates are scored with `tagScore` on the text
 * `textOf` returns (comma-separated tags or phrases); only those passing `isGoodMatch` count.
 * Ties go to the candidate with fewer tags, then to the input order. Without meaningful
 * terms the first candidate wins.
 */
export function bestMatch<T>(candidates: readonly T[], name: string | undefined, textOf: (c: T) => string | undefined): T | null {
  const terms = name ? mealTerms(name) : [];
  if (!terms.length) return candidates[0] ?? null;
  let best: T | null = null;
  let bestScore = 0;
  let bestTags = Infinity;
  for (const c of candidates) {
    const text = textOf(c);
    const score = tagScore(terms, text);
    if (!isGoodMatch(score, terms.length)) continue;
    const tagCount = splitTags(text).length;
    if (score > bestScore || (score === bestScore && tagCount < bestTags)) {
      best = c;
      bestScore = score;
      bestTags = tagCount;
    }
  }
  return best;
}
