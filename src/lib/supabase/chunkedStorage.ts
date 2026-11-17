// Key/value storage that splits long values across several entries.
// The device keychain (expo-secure-store) can reject values above ~2 KB, and a
// Supabase session is larger than that, so the session is stored in chunks.
//
// Layout for key K:
//   K            -> manifest "ff1:<generation>:<count>"
//   K.<gen>.<i>  -> chunk i
// New chunks are written under a fresh generation before the manifest is
// switched, so an interrupted write never leaves a half-written value readable.

export type AsyncKeyValue = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type Manifest = { generation: string; count: number };

const MANIFEST_PATTERN = /^ff1:([a-z0-9]+):(\d+)$/;

function utf8Bytes(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function splitByBytes(value: string, chunkBytes: number): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const character of value) {
    const size = utf8Bytes(character);
    if (bytes + size > chunkBytes) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  chunks.push(chunk);
  return chunks;
}

function parseManifest(value: string | null): Manifest | null {
  const match = value?.match(MANIFEST_PATTERN);
  return match ? { generation: match[1], count: Number(match[2]) } : null;
}

function chunkKey(key: string, generation: string, index: number): string {
  return `${key}.${generation}.${index}`;
}

function newGeneration(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createChunkedStorage(backend: AsyncKeyValue, { chunkBytes }: { chunkBytes: number }): AsyncKeyValue {
  async function removeChunks(key: string, manifest: Manifest | null): Promise<void> {
    if (!manifest) return;
    for (let index = 0; index < manifest.count; index += 1) {
      await backend.removeItem(chunkKey(key, manifest.generation, index));
    }
  }

  return {
    async getItem(key) {
      const manifest = parseManifest(await backend.getItem(key));
      if (!manifest) return null;
      const parts: string[] = [];
      for (let index = 0; index < manifest.count; index += 1) {
        const part = await backend.getItem(chunkKey(key, manifest.generation, index));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const previous = parseManifest(await backend.getItem(key));
      const generation = newGeneration();
      const chunks = splitByBytes(value, chunkBytes);
      for (let index = 0; index < chunks.length; index += 1) {
        await backend.setItem(chunkKey(key, generation, index), chunks[index]);
      }
      await backend.setItem(key, `ff1:${generation}:${chunks.length}`);
      await removeChunks(key, previous);
    },

    async removeItem(key) {
      const manifest = parseManifest(await backend.getItem(key));
      await backend.removeItem(key);
      await removeChunks(key, manifest);
    },
  };
}
