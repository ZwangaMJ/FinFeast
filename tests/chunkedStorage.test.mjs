import assert from 'node:assert/strict';
import test from 'node:test';

import { createChunkedStorage } from '../src/lib/supabase/chunkedStorage.ts';

const LIMIT_BYTES = 100;

// Stands in for the device keychain, which can reject large values.
function fakeKeychain() {
  const entries = new Map();
  return {
    entries,
    async getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    async setItem(key, value) {
      if (Buffer.byteLength(value, 'utf8') > LIMIT_BYTES) throw new Error(`value for ${key} is too large`);
      if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`invalid key ${key}`);
      entries.set(key, value);
    },
    async removeItem(key) {
      entries.delete(key);
    },
  };
}

// A Supabase session is a long JSON string; include multi-byte characters.
const session = JSON.stringify({ access_token: 'a'.repeat(250), refresh_token: 'r'.repeat(40), user: { name: 'Thabo Ndlovu — ☕' } });

test('a value larger than the keychain limit round-trips', async () => {
  const storage = createChunkedStorage(fakeKeychain(), { chunkBytes: LIMIT_BYTES });

  await storage.setItem('sb-project-auth-token', session);

  assert.equal(await storage.getItem('sb-project-auth-token'), session);
});

test('a key that was never written reads as null', async () => {
  const storage = createChunkedStorage(fakeKeychain(), { chunkBytes: LIMIT_BYTES });
  assert.equal(await storage.getItem('sb-project-auth-token'), null);
});

test('overwriting with a shorter value leaves no stale chunks behind', async () => {
  const keychain = fakeKeychain();
  const storage = createChunkedStorage(keychain, { chunkBytes: LIMIT_BYTES });

  await storage.setItem('sb-project-auth-token', session);
  await storage.setItem('sb-project-auth-token', 'short');

  assert.equal(await storage.getItem('sb-project-auth-token'), 'short');
  assert.equal(keychain.entries.size, 2, 'expected only the manifest and one chunk');
});

test('removing a value clears every entry it used', async () => {
  const keychain = fakeKeychain();
  const storage = createChunkedStorage(keychain, { chunkBytes: LIMIT_BYTES });

  await storage.setItem('sb-project-auth-token', session);
  await storage.removeItem('sb-project-auth-token');

  assert.equal(await storage.getItem('sb-project-auth-token'), null);
  assert.equal(keychain.entries.size, 0);
});
