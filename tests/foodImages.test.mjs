import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RECIPES } from '@/data/recipes';
import { cacheKey as clientCacheKey, createFoodImageResolver, creditLine as clientCredit, mealImageKey as clientKey, NO_MATCH_TTL_MS as CLIENT_NO_MATCH_TTL, OK_TTL_MS as CLIENT_OK_TTL, toImageRef } from '@/lib/foodImages';
import { bestMatch, isGoodMatch, maxScore, mealImageKey as serverKey, mealTerms, normalizeSpelling, stem, tagScore } from '../supabase/functions/_shared/foodMatch.ts';
import {
  buildSearchUrl,
  cacheKey,
  creditLine,
  isFoodKind,
  isFresh,
  NO_MATCH_TTL_MS,
  OK_TTL_MS,
  pickHit,
  redactKey,
  searchQuery,
  storagePathFromUrl,
  storagePaths,
  supersededPaths,
  toCacheRow,
  userUrl,
} from '../supabase/functions/fetch-food-image/pixabay.ts';

const NOW = Date.parse('2026-11-23T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A trimmed, real-shape Pixabay hit. */
const hit = (over = {}) => ({
  id: 5984283,
  pageURL: 'https://pixabay.com/photos/chili-con-carne-beans-5984283/',
  type: 'photo',
  tags: 'chili, minced meat, beans, lunch, spices, food',
  previewURL: 'https://cdn.pixabay.com/photo/2021/02/18/chili-5984283_150.jpg',
  webformatURL: 'https://pixabay.com/get/g1_640.jpg',
  webformatWidth: 640,
  webformatHeight: 427,
  largeImageURL: 'https://pixabay.com/get/g2_1280.jpg',
  imageWidth: 6000,
  imageHeight: 4000,
  user: 'RitaE',
  user_id: 19628,
  ...over,
});
const STORED = {
  imageUrl: 'https://x.supabase.co/storage/v1/object/public/meal-images/food/meal-bean-chilli/5984283.jpg',
  thumbUrl: 'https://x.supabase.co/storage/v1/object/public/meal-images/food/meal-bean-chilli/5984283-thumb.jpg',
};


describe('shared keys and spelling', () => {
  it('normalizes case, accents, punctuation and whitespace', () => {
    assert.equal(serverKey('  Crème  Brûlée & Berries! '), 'creme brulee berries');
    assert.equal(serverKey('x'.repeat(200)).length, 80);
  });

  it('matches between the app and the Edge Function for every starter recipe', () => {
    for (const r of RECIPES) {
      assert.equal(clientKey(r.name), serverKey(r.name), r.name);
      assert.equal(clientCacheKey(r.name, 'meal'), cacheKey(r.name, 'meal'), r.name);
    }
    assert.equal(cacheKey('Milk', 'grocery'), 'grocery:milk');
  });

  it('uses the same cache TTLs on both sides', () => {
    assert.equal(CLIENT_OK_TTL, OK_TTL_MS);
    assert.equal(CLIENT_NO_MATCH_TTL, NO_MATCH_TTL_MS);
  });

  it('normalizes local spellings and stems variants', () => {
    assert.equal(normalizeSpelling('Soya mince Bolognaise'), 'Soya minced bolognese');
    assert.equal(stem('Chilli'), stem('chili'));
    assert.equal(stem('beans'), 'bean');
    assert.equal(stem('tomatoes'), stem('tomato'));
    assert.deepEqual(mealTerms('Roast sweet potato bean bowl'), ['swet', 'potato', 'bean']);
  });
});

describe('matching (shared by providers)', () => {
  const tags = (s) => s;
  const sprouts = { id: 1, tags: 'tomato, onion, wallpaper hd, 4k wallpaper, pepper, spicy, chili, gourmet, kitchen, food, bean sprouts' };
  const beanChili = { id: 3, tags: 'bean chili, chili, beans, stew' };

  it('weights the dish word double and gives half credit to modifiers', () => {
    const terms = mealTerms('Bean chilli');
    assert.equal(tagScore(terms, sprouts.tags), 2.5);
    assert.equal(tagScore(terms, beanChili.tags), 3);
    assert.equal(maxScore(3), 4);
    assert.equal(isGoodMatch(2, 3), false);
    assert.equal(isGoodMatch(2.5, 3), true);
  });

  it('prefers the best description and rejects one-word coincidences', () => {
    assert.equal(bestMatch([sprouts, beanChili], 'Bean chilli', (c) => tags(c.tags)).id, 3);
    const pies = { id: 9, tags: 'christmas food, mince pies, food, pie, mince' };
    assert.equal(bestMatch([pies], 'Soya mince bolognaise', (c) => c.tags), null);
  });

  it('breaks ties in favour of fewer tags and falls back to the first candidate without terms', () => {
    const spammy = { id: 10, tags: 'chili, beans, wallpaper hd, 4k wallpaper, background' };
    const clean = { id: 11, tags: 'chili, beans, stew' };
    assert.equal(bestMatch([spammy, clean], 'Bean chilli', (c) => c.tags).id, 11);
    assert.equal(bestMatch([{ id: 5, tags: 'salad' }], 'Food', (c) => c.tags).id, 5);
  });
});

describe('Pixabay request', () => {
  it('adds a food hint for meals only, with spelling normalized, within 100 characters', () => {
    assert.equal(searchQuery('Beef mince bolognaise', 'meal'), 'Beef minced bolognese food');
    assert.equal(searchQuery('  Toilet   paper ', 'grocery'), 'Toilet paper');
    assert.ok(searchQuery('x'.repeat(80), 'meal').length <= 100);
  });

  it('maps to Pixabay query parameters, with the key as a query param', () => {
    const url = new URL(buildSearchUrl('k3y', 'Mac & cheese', 'meal'));
    assert.equal(url.origin + url.pathname, 'https://pixabay.com/api/');
    assert.equal(url.searchParams.get('key'), 'k3y');
    assert.equal(url.searchParams.get('q'), 'Mac & cheese food');
    assert.match(url.search, /q=Mac\+%26\+cheese\+food/);
    assert.equal(url.searchParams.get('image_type'), 'photo');
    assert.equal(url.searchParams.get('category'), 'food');
    assert.equal(url.searchParams.get('orientation'), 'horizontal');
    assert.equal(url.searchParams.get('safesearch'), 'true');
    assert.equal(url.searchParams.get('per_page'), '20');
    assert.equal(new URL(buildSearchUrl('k', 'Milk', 'grocery')).searchParams.has('category'), false);
  });

  it('clamps per_page to 3-200 and redacts the key for logging', () => {
    assert.equal(new URL(buildSearchUrl('k', 'x', 'meal', { perPage: 1 })).searchParams.get('per_page'), '3');
    assert.equal(new URL(buildSearchUrl('k', 'x', 'meal', { perPage: 500 })).searchParams.get('per_page'), '200');
    assert.equal(redactKey(buildSearchUrl('secret', 'x', 'meal')).includes('secret'), false);
  });

  it('validates kinds', () => {
    assert.equal(isFoodKind('meal'), true);
    assert.equal(isFoodKind('grocery'), true);
    assert.equal(isFoodKind('drink'), false);
  });
});

describe('Pixabay response mapping', () => {
  it('picks the hit whose tags match, skipping unusable ones', () => {
    const r = { hits: [hit({ id: 1, tags: 'coffee, coffee beans, roast' }), hit({ id: 2, largeImageURL: undefined }), hit({ id: 3 })] };
    assert.equal(pickHit(r, 'Bean chilli').id, 3);
    assert.equal(pickHit({ hits: [hit({ type: 'illustration' })] }, 'Bean chilli'), null);
  });

  it('handles empty, missing and unmatched results', () => {
    assert.equal(pickHit({ total: 0, totalHits: 0, hits: [] }, 'Bean chilli'), null);
    assert.equal(pickHit({}, 'Bean chilli'), null);
    assert.equal(pickHit(null, 'Bean chilli'), null);
    assert.equal(pickHit({ hits: [hit({ tags: 'salad, lettuce' })] }, 'Bean chilli'), null);
  });

  it('maps a hit to a cache row pointing at our stored copies, never the Pixabay CDN', () => {
    const row = toCacheRow('meal:bean chilli', 'Bean chilli', hit(), STORED, new Date(NOW));
    assert.equal(row.status, 'ok');
    assert.equal(row.provider, 'pixabay');
    assert.equal(row.photo_id, '5984283');
    assert.equal(row.image_url, STORED.imageUrl);
    assert.equal(row.thumb_url, STORED.thumbUrl);
    assert.doesNotMatch(row.image_url + row.thumb_url, /pixabay\.com/);
    assert.equal(row.alt, 'chili, minced meat, beans, lunch, spices, food');
    assert.equal(row.photographer_name, 'RitaE');
    assert.equal(row.photographer_url, 'https://pixabay.com/users/RitaE-19628/');
    assert.equal(row.source_url, 'https://pixabay.com/photos/chili-con-carne-beans-5984283/');
    assert.equal(row.fetched_at, '2026-11-23T00:00:00.000Z');
    assert.equal(creditLine('RitaE'), 'RitaE on Pixabay');
    assert.equal(creditLine(' '), 'Pixabay');
    assert.equal(userUrl({ user: 'x' }), null);
  });

  it('maps no hit (or no stored copy) to a no_match row', () => {
    for (const row of [toCacheRow('k', 'K', null, null), toCacheRow('k', 'K', hit(), null)]) {
      assert.equal(row.status, 'no_match');
      assert.equal(row.image_url, null);
    }
  });

  it('caches no_match search results for 24 hours and stored photos for a year', () => {
    const at = (ms) => new Date(NOW - ms).toISOString();
    assert.equal(isFresh({ status: 'no_match', fetched_at: at(23 * 60 * 60 * 1000) }, NOW), true);
    assert.equal(isFresh({ status: 'no_match', fetched_at: at(25 * 60 * 60 * 1000) }, NOW), false);
    assert.equal(isFresh({ status: 'ok', fetched_at: at(300 * DAY) }, NOW), true);
    assert.equal(isFresh({ status: 'ok', fetched_at: at(400 * DAY) }, NOW), false);
    assert.equal(isFresh({ status: 'ok', fetched_at: 'garbage' }, NOW), false);
  });
});

describe('stored copies', () => {
  const url = (p) => `https://x.supabase.co/storage/v1/object/public/meal-images/${p}`;

  it('stores copies under a slugged path that includes the hit id', () => {
    assert.deepEqual(storagePaths('meal:mac cheese', { id: 7 }), { large: 'food/meal-mac-cheese/7.jpg', thumb: 'food/meal-mac-cheese/7-thumb.jpg' });
    assert.deepEqual(storagePaths('', { id: 7 }), { large: 'food/food/7.jpg', thumb: 'food/food/7-thumb.jpg' });
  });

  it('extracts bucket paths only from our Storage URLs', () => {
    assert.equal(storagePathFromUrl(url('food/a/1.jpg?v=2')), 'food/a/1.jpg');
    assert.equal(storagePathFromUrl('https://cdn.pixabay.com/photo/1.jpg'), null);
    assert.equal(storagePathFromUrl(url('../secrets/x.jpg')), null);
    assert.equal(storagePathFromUrl(null), null);
  });

  it('deletes only the old copies the new row no longer uses', () => {
    const prev = { image_url: url('food/a/1.jpg'), thumb_url: url('food/a/1-thumb.jpg') };
    assert.deepEqual(supersededPaths(prev, { image_url: url('food/a/2.jpg'), thumb_url: url('food/a/2-thumb.jpg') }), ['food/a/1.jpg', 'food/a/1-thumb.jpg']);
    assert.deepEqual(supersededPaths(prev, prev), []);
    assert.deepEqual(supersededPaths(null, prev), []);
  });
});


describe('client resolver (no live API)', () => {
  const okRow = { status: 'ok', image_url: 'https://img/large.jpg', thumb_url: 'https://img/medium.jpg', photographer_name: 'A', photographer_url: 'https://p/a', source_url: 'https://p/1', provider: 'pixabay', fetched_at: new Date(NOW).toISOString() };

  function fakeClient({ row = null, invoke = async () => ({ data: null, error: new Error('offline') }) } = {}) {
    const calls = { select: 0, invoke: [] };
    const chain = { eq: () => chain, maybeSingle: async () => (calls.select++, { data: row, error: null }) };
    return {
      calls,
      client: {
        from: () => ({ select: () => chain }),
        functions: { invoke: async (name, opts) => (calls.invoke.push(opts.body), invoke(name, opts)) },
      },
    };
  }

  it('returns null without a client (Supabase unconfigured) or when getting it throws', async () => {
    assert.equal(await createFoodImageResolver(() => null).resolve('Bean chilli'), null);
    const throwing = createFoodImageResolver(() => {
      throw new Error('not configured');
    });
    assert.equal(await throwing.resolve('Bean chilli'), null);
  });

  it('uses a fresh cached row without calling the function', async () => {
    const { client, calls } = fakeClient({ row: okRow });
    const { resolve, peek } = createFoodImageResolver(() => client, () => NOW);
    const image = await resolve('Bean chilli');
    assert.equal(image.url, 'https://img/large.jpg');
    assert.equal(image.thumbUrl, 'https://img/medium.jpg');
    assert.equal(calls.invoke.length, 0);
    assert.deepEqual(peek('bean  CHILLI'), image);
  });

  it('calls the function with the kind on a miss, and dedupes concurrent lookups', async () => {
    const { client, calls } = fakeClient({ invoke: async () => ({ data: okRow, error: null }) });
    const { resolve } = createFoodImageResolver(() => client, () => NOW);
    const [a, b] = await Promise.all([resolve('Milk', 'grocery'), resolve('Milk', 'grocery')]);
    assert.equal(a, b);
    assert.deepEqual(calls.invoke, [{ query: 'Milk', kind: 'grocery' }]);
  });

  it('keeps meal and grocery answers apart', async () => {
    const { client, calls } = fakeClient({ invoke: async () => ({ data: okRow, error: null }) });
    const { resolve } = createFoodImageResolver(() => client, () => NOW);
    await resolve('Apple', 'meal');
    await resolve('Apple', 'grocery');
    assert.equal(calls.invoke.length, 2);
  });

  it('falls back to null when offline, rate-limited or unconfigured, and retries later', async () => {
    for (const invoke of [undefined, async () => ({ data: { status: 'unavailable', reason: 'rate_limited' }, error: null }), async () => ({ data: { status: 'unavailable', reason: 'not_configured' }, error: null })]) {
      const { client, calls } = fakeClient(invoke ? { invoke } : {});
      const { resolve, peek } = createFoodImageResolver(() => client, () => NOW);
      assert.equal(await resolve('Bean chilli'), null);
      assert.equal(peek('Bean chilli'), undefined);
      await resolve('Bean chilli');
      assert.equal(calls.invoke.length, 2);
    }
  });

  it('remembers a no_match answer and serves a stale photo when the refresh fails', async () => {
    const noMatch = fakeClient({ invoke: async () => ({ data: { status: 'no_match', fetched_at: new Date(NOW).toISOString() }, error: null }) });
    const r1 = createFoodImageResolver(() => noMatch.client, () => NOW);
    assert.equal(await r1.resolve('Bean chilli'), null);
    assert.equal(r1.peek('Bean chilli'), null);

    const stale = { ...okRow, fetched_at: new Date(NOW - 40 * DAY).toISOString() };
    const offline = fakeClient({ row: stale });
    const r2 = createFoodImageResolver(() => offline.client, () => NOW);
    assert.equal((await r2.resolve('Bean chilli')).url, 'https://img/large.jpg');
  });

  it('maps rows and credits the photographer', () => {
    assert.equal(toImageRef({ status: 'no_match' }), null);
    assert.equal(toImageRef({ status: 'ok', image_url: null }), null);
    assert.equal(toImageRef({ status: 'ok', image_url: 'https://x' }).thumbUrl, 'https://x');
    assert.equal(clientCredit({ photographer: 'Rita', provider: 'pixabay' }), 'Rita on Pixabay');
    assert.equal(clientCredit({ photographer: null, provider: null }), 'Pixabay');
    assert.equal(clientCredit({ photographer: 'Ella', provider: 'pexels' }), 'Ella on Pexels');
  });
});
