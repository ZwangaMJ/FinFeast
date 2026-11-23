import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK_BYTES = 1800;

const webStorage = {
  getItem: async (key: string) => (typeof window === 'undefined' ? null : window.localStorage.getItem(key)),
  setItem: async (key: string, value: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};

function chunkUtf8(value: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let bytes = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + characterBytes > CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += character;
    bytes += characterBytes;
  }

  if (chunk) chunks.push(chunk);
  if (!chunks.length) chunks.push('');
  return chunks;
}

function parseManifest(value: string | null): { generation: string; count: number } | null {
  const match = value?.match(/^ff1:([a-z0-9-]+):(\d+)$/);
  if (!match) return null;
  const count = Number(match[2]);
  return Number.isSafeInteger(count) && count > 0 ? { generation: match[1], count } : null;
}

async function removeGeneration(key: string, generation: string, count: number): Promise<void> {
  await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(`${key}:${generation}:${index}`)));
}

const secureStorage = {
  getItem: async (key: string) => {
    const manifestValue = await SecureStore.getItemAsync(key);
    const manifest = parseManifest(manifestValue);
    if (!manifest) {
      const legacyValue = await AsyncStorage.getItem(key);
      if (legacyValue !== null) {
        await secureStorage.setItem(key, legacyValue);
        await AsyncStorage.removeItem(key);
        return legacyValue;
      }
      return manifestValue;
    }

    const chunks = await Promise.all(
      Array.from({ length: manifest.count }, (_, index) => SecureStore.getItemAsync(`${key}:${manifest.generation}:${index}`)),
    );
    if (chunks.some((chunk) => chunk === null)) throw new Error('Could not read the saved secure sign-in session.');
    return chunks.join('');
  },
  setItem: async (key: string, value: string) => {
    const previousManifest = parseManifest(await SecureStore.getItemAsync(key));
    const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const chunks = chunkUtf8(value);
    for (const [index, chunk] of chunks.entries()) {
      await SecureStore.setItemAsync(`${key}:${generation}:${index}`, chunk);
    }
    await SecureStore.setItemAsync(key, `ff1:${generation}:${chunks.length}`);
    if (previousManifest) await removeGeneration(key, previousManifest.generation, previousManifest.count);
  },
  removeItem: async (key: string) => {
    const manifest = parseManifest(await SecureStore.getItemAsync(key));
    if (manifest) await removeGeneration(key, manifest.generation, manifest.count);
    await SecureStore.deleteItemAsync(key);
    await AsyncStorage.removeItem(key);
  },
};

export const authStorage = Platform.OS === 'web' ? webStorage : secureStorage;
