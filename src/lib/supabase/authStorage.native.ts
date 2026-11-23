// iOS/Android: keep the Supabase session in the device keychain/keystore.
// Sessions exceed the ~2 KB some keychains accept, so they are stored in chunks.
import * as SecureStore from 'expo-secure-store';

import { createChunkedStorage } from './chunkedStorage';

export const authStorage = createChunkedStorage(
  {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
  { chunkBytes: 1800 },
);
