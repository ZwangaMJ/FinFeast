import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabase/client';
import { supabaseDataRepository } from '@/lib/supabase/dataRepository';
import { flushCloudSync, getCloudSyncStatus, startCloudSync, stopCloudSync } from '@/lib/supabase/sync';
import { getAppData, initialData, useStore, type AppData } from './useStore';

const STORAGE_KEY = 'finfeast-v1';
const legacyStorageKey = STORAGE_KEY;
const userStorageKey = (userId: string) => `${STORAGE_KEY}:${userId}`;

export type AuthStatus = 'checking' | 'signedOut' | 'loading' | 'ready' | 'error';

type AuthState = {
  status: AuthStatus;
  userId: string | null;
  error: string | null;
  initialize: () => Promise<void>;
  retry: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  deleteAllData: () => Promise<void>;
};

let initializePromise: Promise<void> | null = null;
let activeUserId: string | null = null;
let loadingUserId: string | null = null;
let loadingPromise: Promise<void> | null = null;
let sessionGeneration = 0;
let unsubscribePersistence: (() => void) | null = null;
let persistenceQueue = Promise.resolve();

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'An unexpected authentication error occurred.';
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

async function stopLocalPersistence(): Promise<void> {
  unsubscribePersistence?.();
  unsubscribePersistence = null;
  await persistenceQueue;
}

async function persistForUser(userId: string): Promise<void> {
  const key = userStorageKey(userId);
  await AsyncStorage.setItem(key, JSON.stringify(getAppData()));
  persistenceQueue = Promise.resolve();
  unsubscribePersistence = useStore.subscribe((state) => {
    const serialized = JSON.stringify(getAppData(state));
    persistenceQueue = persistenceQueue
      .then(() => AsyncStorage.setItem(key, serialized))
      .catch((error: unknown) => {
        useAuthStore.setState({ error: `Could not save your data on this device: ${errorMessage(error)}` });
      });
  });
}

async function loadSession(session: Session): Promise<void> {
  const userId = session.user.id;
  if (activeUserId === userId && useAuthStore.getState().status === 'ready') return;
  if (loadingUserId === userId && loadingPromise) return loadingPromise;

  const generation = ++sessionGeneration;
  const previousUserId = activeUserId;
  loadingUserId = userId;
  loadingPromise = (async () => {
    useAuthStore.setState({ status: 'loading', userId, error: null });
    stopCloudSync();

    try {
      await stopLocalPersistence();
      if (previousUserId && previousUserId !== userId) {
        await AsyncStorage.removeItem(userStorageKey(previousUserId));
      }
      if (generation !== sessionGeneration) return;

      activeUserId = null;
      useStore.setState(initialData);
      const email = session.user.email ?? '';
      const cloudData = await supabaseDataRepository.load(userId, email);
      if (generation !== sessionGeneration) return;

      const { data: currentSession, error: sessionError } = await getSupabaseClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (currentSession.session?.user.id !== userId) return;

      let data = cloudData;

      if (!data) {
        const saved = await AsyncStorage.getItem(userStorageKey(userId));
        const legacy = saved ? null : await AsyncStorage.getItem(legacyStorageKey);
        const stored = saved ?? legacy;
        if (stored) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(stored);
          } catch (error) {
            throw new Error(`Could not read your saved device data: ${errorMessage(error)}`);
          }
          data = normalizeStoredData(parsed);
        } else {
          data = initialData;
        }

        if (generation !== sessionGeneration) return;
        data = { ...data, profile: { ...data.profile, email } };
        useStore.setState(data);
        await supabaseDataRepository.save(data, userId);
      } else {
        if (generation !== sessionGeneration) return;
        data = { ...data, profile: { ...data.profile, email } };
        useStore.setState(data);
      }

      if (generation !== sessionGeneration) return;
      await AsyncStorage.removeItem(legacyStorageKey);
      activeUserId = userId;
      await persistForUser(userId);
      startCloudSync(userId);
      useAuthStore.setState({ status: 'ready', userId, error: null });
    } catch (error) {
      if (generation !== sessionGeneration) return;
      activeUserId = null;
      useAuthStore.setState({ status: 'error', userId: null, error: errorMessage(error) });
      throw error;
    }
  })().finally(() => {
    if (generation === sessionGeneration) {
      loadingUserId = null;
      loadingPromise = null;
    }
  });

  return loadingPromise;
}

async function clearSignedOutSession(): Promise<void> {
  const previousUserId = activeUserId ?? useAuthStore.getState().userId;
  sessionGeneration += 1;
  loadingUserId = null;
  loadingPromise = null;
  stopCloudSync();
  await stopLocalPersistence();
  activeUserId = null;
  useStore.setState(initialData);
  if (previousUserId) await AsyncStorage.removeItem(userStorageKey(previousUserId));
  useAuthStore.setState({ status: 'signedOut', userId: null, error: null });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'checking',
  userId: null,
  error: null,

  initialize: () => {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      set({ status: 'checking', error: null });
      try {
        const client = getSupabaseClient();
        client.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') {
            setTimeout(() => {
              void clearSignedOutSession().catch((error: unknown) => set({ status: 'error', error: errorMessage(error) }));
            }, 0);
          } else if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
            setTimeout(() => {
              void loadSession(session).catch(() => {});
            }, 0);
          }
        });

        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (data.session) await loadSession(data.session);
        else set({ status: 'signedOut', userId: null, error: null });
      } catch (error) {
        set({ status: 'error', userId: null, error: errorMessage(error) });
      }
    })().finally(() => {
      initializePromise = null;
    });
    return initializePromise;
  },

  retry: async () => {
    set({ status: 'checking', error: null });
    try {
      const { data, error } = await getSupabaseClient().auth.getSession();
      if (error) throw error;
      if (data.session) await loadSession(data.session);
      else set({ status: 'signedOut', userId: null, error: null });
    } catch (error) {
      set({ status: 'error', userId: null, error: errorMessage(error) });
    }
  },

  signIn: async (email, password) => {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session) throw new Error('The sign-in completed without an active session. Please try again.');
    await loadSession(data.session);
  },

  signUp: async (email, password) => {
    const { data, error } = await getSupabaseClient().auth.signUp({ email, password });
    if (error) throw error;
    if (!data.session) return false;
    await loadSession(data.session);
    return true;
  },

  signOut: async () => {
    const saved = await flushCloudSync();
    if (!saved) throw new Error(getCloudSyncStatus().error ?? 'Your latest changes could not be saved. Try again before signing out.');

    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
    await clearSignedOutSession();
  },

  deleteAllData: async () => {
    const userId = get().userId;
    if (!userId) throw new Error('You must be signed in to delete your data.');

    const saved = await flushCloudSync();
    if (!saved) throw new Error(getCloudSyncStatus().error ?? 'Your latest changes could not be saved. Try again before deleting your data.');

    stopCloudSync();
    try {
      await supabaseDataRepository.delete(userId);
      useStore.setState(initialData);
      startCloudSync(userId);
    } catch (error) {
      startCloudSync(userId);
      throw error;
    }
  },
}));
