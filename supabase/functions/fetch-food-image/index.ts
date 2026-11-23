// Supabase Edge Function (Deno): resolves a meal or grocery name to a cached Pixabay photo.
// Secret (never EXPO_PUBLIC_*): `npx supabase secrets set PIXABAY_API_KEY=...`
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// Request:  POST { query: string, kind?: 'meal' | 'grocery' }
// Response: a `food_image_cache` row (status 'ok' | 'no_match'), or
//           { status: 'unavailable', reason: 'not_configured' | 'rate_limited' | 'upstream_error' }
//           so the client falls back to its emoji.
//
// Pixabay forbids permanent hotlinking, so the chosen photo is copied into the public
// `meal-images` bucket and the cache row points at our copies.

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  buildSearchUrl,
  cacheKey,
  isFoodKind,
  isFresh,
  MAX_DOWNLOAD_BYTES,
  MAX_MEAL_NAME,
  pickHit,
  PROVIDER,
  redactKey,
  STORAGE_BUCKET,
  storagePaths,
  supersededPaths,
  toCacheRow,
  type FoodImageCacheRow,
  type FoodKind,
  type PixabayHit,
  type PixabayResponse,
} from './pixabay.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PIXABAY_API_KEY = Deno.env.get('PIXABAY_API_KEY');
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

class RateLimitedError extends Error {}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function searchPixabay(query: string, kind: FoodKind): Promise<PixabayResponse> {
  const url = buildSearchUrl(PIXABAY_API_KEY!, query, kind);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new RateLimitedError('Pixabay API rate limit exceeded');
  if (!res.ok) throw new Error(`Pixabay search failed: ${res.status} ${(await res.text()).slice(0, 200)} (${redactKey(url)})`);
  return (await res.json()) as PixabayResponse;
}

async function download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error(`Unexpected image content-type: ${contentType}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`Image too large: ${bytes.byteLength} bytes`);
  return { bytes, contentType };
}

/** Copies the hit (1280 px + 640 px) into our bucket and returns our public URLs. */
async function storeCopies(key: string, hit: PixabayHit): Promise<{ imageUrl: string; thumbUrl: string }> {
  const paths = storagePaths(key, hit);
  const [large, thumb] = await Promise.all([download(hit.largeImageURL!), download(hit.webformatURL!)]);
  const bucket = db.storage.from(STORAGE_BUCKET);
  for (const [path, file] of [
    [paths.large, large],
    [paths.thumb, thumb],
  ] as const) {
    const { error } = await bucket.upload(path, file.bytes, { contentType: file.contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
  }
  return { imageUrl: bucket.getPublicUrl(paths.large).data.publicUrl, thumbUrl: bucket.getPublicUrl(paths.thumb).data.publicUrl };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { query?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const { query } = body;
  const kind = body.kind === undefined ? 'meal' : body.kind;
  if (typeof query !== 'string' || !query.trim() || query.length > MAX_MEAL_NAME) return json({ error: `query must be a string of 1-${MAX_MEAL_NAME} characters` }, 400);
  if (!isFoodKind(kind)) return json({ error: "kind must be 'meal' or 'grocery'" }, 400);
  const name = query.trim();
  const key = cacheKey(name, kind);
  if (key.endsWith(':')) return json({ error: 'query has no searchable text' }, 400);

  const { data: cached } = await db.from('food_image_cache').select('*').eq('query_key', key).eq('provider', PROVIDER).maybeSingle<FoodImageCacheRow>();
  if (cached && isFresh(cached)) return json(cached);

  if (!PIXABAY_API_KEY) return json({ status: 'unavailable', reason: 'not_configured' });

  try {
    const hit = pickHit(await searchPixabay(name, kind), name);
    const row = toCacheRow(key, name, hit, hit ? await storeCopies(key, hit) : null);
    const { error } = await db.from('food_image_cache').upsert(row, { onConflict: 'query_key,provider' });
    if (error) {
      console.error('food_image_cache upsert failed', error.message);
    } else {
      // The row now points at the new copies; delete the ones it replaced.
      const stale = supersededPaths(cached, row);
      if (stale.length) {
        const { error: rmError } = await db.storage.from(STORAGE_BUCKET).remove(stale);
        if (rmError) console.error('Removing superseded copies failed', rmError.message);
      }
    }
    return json(row);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(detail);
    if (cached?.status === 'ok') return json(cached); // our stored copy beats an emoji
    // `detail` never includes the API key (see redactKey).
    return json({ status: 'unavailable', reason: err instanceof RateLimitedError ? 'rate_limited' : 'upstream_error', detail });
  }
});
