// A copy of the signed-in account's data on this device (AsyncStorage), so a
// new or empty cloud account can be seeded from it. The cloud is the source of
// truth; this copy is removed on sign-out and account deletion.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getAppData, initialData, useStore, type AppData } from './useStore';

// Data saved before accounts existed lived under this key.
const LEGACY_KEY = 'finfeast-v1';
const keyFor = (userId: string) => `${LEGACY_KEY}:${userId}`;

let unsubscribe: (() => void) | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let onWriteError: (message: string) => void = () => {};

function normalizeStoredData(value: unknown): AppData {
  if (!value || typeof value !== 'object') throw new Error('The saved device data is not valid JSON.');
  const parsed = value as Record<string, unknown>;
  const state = parsed.state && typeof parsed.state === 'object' ? (parsed.state as Record<string, unknown>) : parsed;
  const storedProfile = state.profile;
  if (!storedProfile || typeof storedProfile !== 'object') throw new Error('The saved device data is missing its profile.');

  const profile = { ...initialData.profile, ...(storedProfile as Partial<AppData['profile']>) };
  const settings = { ...initialData.settings, ...(state.settings as Partial<AppData['settings']> | undefined) };
  return { ...initialData, ...state, profile, settings } as AppData;
}

async function read(key: string): Promise<AppData | null> {
  const saved = await AsyncStorage.getItem(key);
  if (!saved) return null;
  try {
    return normalizeStoredData(JSON.parse(saved));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the FinFeast data saved on this device: ${reason}`);
  }
}

export const deviceCache = {
  load: (userId: string) => read(keyFor(userId)),
  loadLegacy: () => read(LEGACY_KEY),
  removeLegacy: () => AsyncStorage.removeItem(LEGACY_KEY),
  remove: (userId: string) => AsyncStorage.removeItem(keyFor(userId)),

  startSaving(userId: string, getData: () => AppData): void {
    unsubscribe?.();
    const key = keyFor(userId);
    const write = (data: AppData) => {
      const serialized = JSON.stringify(data);
      writeQueue = writeQueue
        .then(() => AsyncStorage.setItem(key, serialized))
        .catch((error: unknown) => {
          onWriteError(`Could not save your data on this device: ${error instanceof Error ? error.message : String(error)}`);
        });
    };
    write(getData());
    unsubscribe = useStore.subscribe((state) => write(getAppData(state)));
  },

  async stopSaving(): Promise<void> {
    unsubscribe?.();
    unsubscribe = null;
    await writeQueue;
  },

  onWriteError(handler: (message: string) => void): void {
    onWriteError = handler;
  },
};
