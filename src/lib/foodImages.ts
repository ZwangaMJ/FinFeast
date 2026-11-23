/**
 * Resolves meal and grocery names to food photos. Reads the public `food_image_cache` table
 * first and only calls the `fetch-food-image` Edge Function on a miss or stale row, so the
 * photo API is hit at most once per name per cache period across all users.
 *
 * Pure (no React Native imports) so it is unit-tested under Node; the Supabase client is
 * injected by `useFoodImage`. Any failure resolves to `null`, which means "show the emoji".
 */
import type { FoodImageRef } from '@/store/types';

export type FoodKind = 'meal' | 'grocery';

type Row = {
  status?: string;
  image_url?: string | null;
  thumb_url?: string | null;
  photographer_name?: string | null;
  photographer_url?: string | null;
  source_url?: string | null;
  provider?: string | null;
  fetched_at?: string | null;
};

type Query = PromiseLike<{ data: Row | null; error: unknown }>;

/** The subset of SupabaseClient this module uses, so tests can pass a fake. */
export type FoodImageClient = {
  from(table: 'food_image_cache'): {
    select(columns: string): { eq(column: 'query_key', value: string): { eq(column: 'provider', value: string): { maybeSingle(): Query } } };
  };
  functions: { invoke(name: 'fetch-food-image', options: { body: { query: string; kind: FoodKind } }): Promise<{ data: unknown; error: unknown }> };
};

export const PROVIDER = 'pixabay';

/** How each photo source is credited and linked (Pixabay asks apps to show where images come from). */
export const PROVIDERS: Record<string, { name: string; url: string; linkLabel: string }> = {
  pixabay: { name: 'Pixabay', url: 'https://pixabay.com', linkLabel: 'Images from Pixabay' },
  pexels: { name: 'Pexels', url: 'https://www.pexels.com', linkLabel: 'Photos provided by Pexels' },
};

export const providerInfo = (provider: string | null | undefined) => PROVIDERS[provider ?? PROVIDER] ?? { name: provider ?? 'the photographer', url: '', linkLabel: '' };
export const MAX_QUERY = 80;
/** Must match OK_TTL_MS / NO_MATCH_TTL_MS in supabase/functions/fetch-food-image/pixabay.ts. */
export const OK_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const NO_MATCH_TTL_MS = 24 * 60 * 60 * 1000;

/** Must match `mealImageKey` in supabase/functions/_shared/foodMatch.ts. */
export function mealImageKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY);
}

/** Must match `cacheKey` in supabase/functions/fetch-food-image/pixabay.ts. */
export const cacheKey = (query: string, kind: FoodKind) => `${kind}:${mealImageKey(query)}`;

function isFresh(row: Row, now: number): boolean {
  const age = now - Date.parse(row.fetched_at ?? '');
  return Number.isFinite(age) && age < (row.status === 'ok' ? OK_TTL_MS : NO_MATCH_TTL_MS);
}

export function toImageRef(row: Row | null | undefined): FoodImageRef | null {
  if (!row || row.status !== 'ok' || !row.image_url) return null;
  return {
    url: row.image_url,
    thumbUrl: row.thumb_url || row.image_url,
    photographer: row.photographer_name ?? null,
    photographerUrl: row.photographer_url ?? null,
    sourceUrl: row.source_url ?? null,
    provider: row.provider ?? PROVIDER,
  };
}

/** "Jane Doe on Pixabay" (or just the provider name). */
export function creditLine(image: Pick<FoodImageRef, 'photographer' | 'provider'>): string {
  const { name } = providerInfo(image.provider);
  return image.photographer ? `${image.photographer} on ${name}` : name;
}

/** `undefined` = transient failure (retry later); `null` = definitive "no photo". */
type Outcome = FoodImageRef | null | undefined;

export function createFoodImageResolver(getClient: () => FoodImageClient | null, now: () => number = Date.now) {
  const settled = new Map<string, FoodImageRef | null>();
  const inflight = new Map<string, Promise<Outcome>>();

  async function lookup(client: FoodImageClient, key: string, query: string, kind: FoodKind): Promise<Outcome> {
    let cached: Row | null = null;
    try {
      const { data } = await client
        .from('food_image_cache')
        .select('status,image_url,thumb_url,photographer_name,photographer_url,source_url,provider,fetched_at')
        .eq('query_key', key)
        .eq('provider', PROVIDER)
        .maybeSingle();
      cached = data;
    } catch {
      // Table unreachable — still try the function below.
    }
    if (cached && isFresh(cached, now())) return toImageRef(cached);

    try {
      const { data, error } = await client.functions.invoke('fetch-food-image', { body: { query, kind } });
      if (error || !data || typeof data !== 'object') return toImageRef(cached) ?? undefined;
      const row = data as Row;
      if (row.status === 'unavailable') return toImageRef(cached) ?? undefined;
      return toImageRef(row);
    } catch {
      return toImageRef(cached) ?? undefined;
    }
  }

  /** Synchronous cache peek so remounts render the photo without a skeleton flash. */
  function peek(query: string, kind: FoodKind = 'meal'): FoodImageRef | null | undefined {
    const key = cacheKey(query.trim().slice(0, MAX_QUERY), kind);
    return settled.has(key) ? settled.get(key)! : undefined;
  }

  function resolve(query: string, kind: FoodKind = 'meal'): Promise<FoodImageRef | null> {
    const name = query.trim().slice(0, MAX_QUERY);
    const key = cacheKey(name, kind);
    if (!mealImageKey(name)) return Promise.resolve(null);
    if (settled.has(key)) return Promise.resolve(settled.get(key)!);

    let client: FoodImageClient | null;
    try {
      client = getClient();
    } catch {
      client = null;
    }
    if (!client) return Promise.resolve(null);

    let pending = inflight.get(key);
    if (!pending) {
      pending = lookup(client, key, name, kind).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending.then((outcome) => {
      if (outcome !== undefined) settled.set(key, outcome);
      return outcome ?? null;
    });
  }

  return { resolve, peek };
}
