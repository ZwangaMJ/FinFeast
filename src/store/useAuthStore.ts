import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { getAppData, initialData, useStore, type AppData } from './useStore';

const STORAGE_KEY = 'finfeast-v1';

export type AuthStatus = 'checking' | 'ready' | 'error';

type AuthState = {
  status: AuthStatus;
  error: string | null;
  initialize: () => Promise<void>;
  retry: () => Promise<void>;
};

let initializePromise: Promise<void> | null = null;
let unsubscribePersistence: (() => void) | null = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'An unexpected local storage error occurred.';
}

function normalizeStoredData(value: unknown): AppData {
  if (!value || typeof value !== 'object') throw new Error('The saved device data is not valid JSON.');
  const parsed = value as Record<string, unknown>;
  const state = parsed.state && typeof parsed.state === 'object' ? (parsed.state as Record<string, unknown>) : parsed;
  const storedProfile = state.profile;
  if (!storedProfile || typeof storedProfile !== 'object') {
    throw new Error('The saved device data is missing its profile.');
  }

  const profile = { ...initialData.profile, ...(storedProfile as Partial<AppData['profile']>) };
  const settings = { ...initialData.settings, ...(state.settings as Partial<AppData['settings']> | undefined) };
  return { ...initialData, ...state, profile, settings } as AppData;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'checking',
  error: null,

  initialize: () => {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      set({ status: 'checking', error: null });
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(saved);
          } catch (error) {
            throw new Error(`Could not read your saved device data: ${errorMessage(error)}`);
          }
          useStore.setState(normalizeStoredData(parsed));
        } else {
          useStore.setState(initialData);
        }

        unsubscribePersistence?.();
        let writeQueue = Promise.resolve();
        unsubscribePersistence = useStore.subscribe((state) => {
          const serialized = JSON.stringify(getAppData(state));
          writeQueue = writeQueue
            .then(() => AsyncStorage.setItem(STORAGE_KEY, serialized))
            .then(() => set({ error: null }))
            .catch((error: unknown) => set({ error: `Could not save your data on this device: ${errorMessage(error)}` }));
        });
        set({ status: 'ready', error: null });
      } catch (error) {
        set({ status: 'error', error: errorMessage(error) });
      }
    })().finally(() => {
      initializePromise = null;
    });
    return initializePromise;
  },

  retry: async () => {
    initializePromise = null;
    await get().initialize();
  },
}));
