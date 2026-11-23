// Web: the browser has no keychain, so the Supabase session lives in
// localStorage (Supabase's default on web). Native uses authStorage.native.ts.
import type { AsyncKeyValue } from './chunkedStorage';

const hasWindow = () => typeof window !== 'undefined' && !!window.localStorage;

export const authStorage: AsyncKeyValue = {
  getItem: async (key) => (hasWindow() ? window.localStorage.getItem(key) : null),
  setItem: async (key, value) => {
    if (hasWindow()) window.localStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    if (hasWindow()) window.localStorage.removeItem(key);
  },
};
