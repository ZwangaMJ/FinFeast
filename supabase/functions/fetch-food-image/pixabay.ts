// Pure Pixabay helpers for the `fetch-food-image` Edge Function (no Deno or Node APIs, so this
// file is unit-tested under Node).
//
// Pixabay API terms encoded here (https://pixabay.com/api/docs/):
// - Auth is a `key` query parameter; 100 requests per 60 s; `429` when exceeded → `rate_limited`.
// - Cache search results for 24 hours → `no_match` rows live for NO_MATCH_TTL_MS.
// - No permanent hotlinking → index.ts copies the chosen photo into our Storage bucket and the
//   cache row only points at our copies (see `storagePaths`).
// - Show where images come from → credit the author and link to the Pixabay page.

import { bestMatch, MAX_MEAL_NAME, mealImageKey, normalizeSpelling } from '../_shared/foodMatch.ts';

export { MAX_MEAL_NAME, mealImageKey };

export const PROVIDER = 'pixabay';
export const PIXABAY_API_URL = 'https://pixabay.com/api/';
export const STORAGE_BUCKET = 'meal-images';
/** Our stored copies don't expire; refresh yearly so better matches can replace them. */
export const OK_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Pixabay asks for search results to be cached for 24 hours. */
export const NO_MATCH_TTL_MS = 24 * 60 * 60 * 1000;
/** Pixabay's `q` limit. */
export const MAX_QUERY = 100;
/** Pixabay accepts per_page 3–200; 20 gives the matcher enough candidates in one request. */
export const PER_PAGE = 20;
/** Largest image we'll copy into Storage. */
export const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export type FoodKind = 'meal' | 'grocery';
export type PixabayOrientation = 'horizontal' | 'vertical' | 'all';

export type PixabayHit = {
  id: number;
  pageURL?: string;
  type?: string;
  tags?: string;
  previewURL?: string;
  webformatURL?: string;
  webformatWidth?: number;
  webformatHeight?: number;
  largeImageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  user?: string;
  user_id?: number;
};

export type PixabayResponse = { total?: number; totalHits?: number; hits?: PixabayHit[] };

export type FoodImageCacheRow = {
  query_key: string;
  provider: typeof PROVIDER;
  query: string;
  status: 'ok' | 'no_match';
  photo_id: string | null;
  image_url: string | null;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
  photographer_name: string | null;
  photographer_url: string | null;
  source_url: string | null;
  fetched_at: string;
};

export const isFoodKind = (v: unknown): v is FoodKind => v === 'meal' || v === 'grocery';

/** Cache key: kind + normalized name, so "Apple" the snack and "apple" the grocery don't collide. */
export const cacheKey = (query: string, kind: FoodKind) => `${kind}:${mealImageKey(query)}`;

/** Meals get a "food" hint; groceries are searched as named (they're not always food). Max 100 chars. */
export function searchQuery(query: string, kind: FoodKind): string {
  const base = normalizeSpelling(query.trim().replace(/\s+/g, ' ')).slice(0, MAX_MEAL_NAME);
  return (kind === 'meal' ? `${base} food` : base).slice(0, MAX_QUERY);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export function buildSearchUrl(apiKey: string, query: string, kind: FoodKind, opts: { orientation?: PixabayOrientation; page?: number; perPage?: number } = {}): string {
  const params = new URLSearchParams({
    key: apiKey,
    q: searchQuery(query, kind),
    image_type: 'photo',
    orientation: opts.orientation ?? 'horizontal',
    safesearch: 'true',
    order: 'popular',
    page: String(clamp(opts.page ?? 1, 1, 500)),
    per_page: String(clamp(opts.perPage ?? PER_PAGE, 3, 200)),
  });
  if (kind === 'meal') params.set('category', 'food');
  return `${PIXABAY_API_URL}?${params.toString()}`;
}

/** Strips the API key so URLs are safe to log. */
export const redactKey = (url: string) => url.replace(/([?&]key=)[^&]*/, '$1***');

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u);

const isUsable = (hit: PixabayHit | null | undefined): hit is PixabayHit =>
  typeof hit?.id === 'number' && (!hit.type || hit.type === 'photo') && isHttps(hit.largeImageURL) && isHttps(hit.webformatURL);

/** Best photo for the name, matched on its tags, or null → emoji fallback. */
export function pickHit(response: PixabayResponse | null | undefined, name?: string): PixabayHit | null {
  return bestMatch((response?.hits ?? []).filter(isUsable), name, (hit) => hit.tags);
}

export function altText(hit: Pick<PixabayHit, 'tags'>): string | null {
  const tags = (hit.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length ? tags.join(', ') : null;
}

export function creditLine(user: string | null | undefined): string {
  const u = user?.trim();
  return u ? `${u} on Pixabay` : 'Pixabay';
}

export function userUrl(hit: Pick<PixabayHit, 'user' | 'user_id'>): string | null {
  return hit.user && typeof hit.user_id === 'number' ? `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/` : null;
}

/** Where our copies live in Storage. The hit id is in the path so a new match busts image caches. */
export function storagePaths(key: string, hit: Pick<PixabayHit, 'id'>): { large: string; thumb: string } {
  const slug = key.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'food';
  return { large: `food/${slug}/${hit.id}.jpg`, thumb: `food/${slug}/${hit.id}-thumb.jpg` };
}

/** The bucket path of one of our public Storage URLs, or null for any other URL. */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const i = url?.indexOf(marker) ?? -1;
  if (!url || i < 0) return null;
  const path = decodeURIComponent(url.slice(i + marker.length).split(/[?#]/)[0]);
  return path && !path.includes('..') ? path : null;
}

/** Stored copies a replaced row pointed at that the new row no longer uses (safe to delete). */
export function supersededPaths(previous: Pick<FoodImageCacheRow, 'image_url' | 'thumb_url'> | null | undefined, next: Pick<FoodImageCacheRow, 'image_url' | 'thumb_url'>): string[] {
  if (!previous) return [];
  const keep = new Set([storagePathFromUrl(next.image_url), storagePathFromUrl(next.thumb_url)]);
  const old = [storagePathFromUrl(previous.image_url), storagePathFromUrl(previous.thumb_url)];
  return [...new Set(old.filter((p): p is string => !!p && !keep.has(p)))];
}

/** Maps a picked hit and the public URLs of our stored copies to a cache row (never Pixabay CDN URLs). */
export function toCacheRow(key: string, query: string, hit: PixabayHit | null, stored: { imageUrl: string; thumbUrl: string } | null, now: Date = new Date()): FoodImageCacheRow {
  const base = { query_key: key, provider: PROVIDER, query, fetched_at: now.toISOString() } as const;
  if (!hit || !stored) {
    return { ...base, status: 'no_match', photo_id: null, image_url: null, thumb_url: null, width: null, height: null, alt: null, photographer_name: null, photographer_url: null, source_url: null };
  }
  return {
    ...base,
    status: 'ok',
    photo_id: String(hit.id),
    image_url: stored.imageUrl,
    thumb_url: stored.thumbUrl,
    width: hit.imageWidth ?? hit.webformatWidth ?? null,
    height: hit.imageHeight ?? hit.webformatHeight ?? null,
    alt: altText(hit),
    photographer_name: hit.user?.trim() || null,
    photographer_url: userUrl(hit),
    source_url: isHttps(hit.pageURL) ? hit.pageURL : null,
  };
}

export function isFresh(row: Pick<FoodImageCacheRow, 'status' | 'fetched_at'>, now: number = Date.now()): boolean {
  const age = now - Date.parse(row.fetched_at);
  if (!Number.isFinite(age)) return false;
  return age < (row.status === 'ok' ? OK_TTL_MS : NO_MATCH_TTL_MS);
}
