import { create } from 'zustand';

import { getAppData, useStore } from '@/store/useStore';
import type { AppData } from '@/store/useStore';
import { supabaseDataRepository } from './dataRepository';

type SyncState = {
  status: 'saved' | 'saving' | 'error';
  error: string | null;
};

const useDataSyncStatus = create<SyncState>(() => ({ status: 'saved', error: null }));

let activeFlush: (() => Promise<boolean>) | null = null;
let activeStop: (() => void) | null = null;

export function startCloudSync(userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: AppData | null = getAppData();
  let inFlight: Promise<boolean> | null = null;
  let lastSaved = '';
  let stopped = false;

  const flush = async (): Promise<boolean> => {
    if (inFlight) {
      const succeeded = await inFlight;
      return succeeded && pending ? flush() : succeeded;
    }

    inFlight = (async () => {
      while (pending && !stopped) {
        const snapshot = pending;
        pending = null;
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSaved) continue;

        useDataSyncStatus.setState({ status: 'saving', error: null });
        try {
          await supabaseDataRepository.save(snapshot, userId);
          lastSaved = serialized;
          useDataSyncStatus.setState({ status: 'saved', error: null });
        } catch (error) {
          pending ??= snapshot;
          const message = error instanceof Error ? error.message : 'Could not save your data to Supabase.';
          useDataSyncStatus.setState({ status: 'error', error: message });
          return false;
        }
      }
      return true;
    })();

    const result = await inFlight;
    inFlight = null;
    return result && pending ? flush() : result;
  };

  const unsubscribe = useStore.subscribe((state) => {
    pending = getAppData(state);
    useDataSyncStatus.setState({ status: 'saving', error: null });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 350);
  });

  activeFlush = flush;
  void flush();

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    if (activeFlush === flush) activeFlush = null;
    if (activeStop === stop) activeStop = null;
  };
  activeStop = stop;
  return stop;
}

export function stopCloudSync(): void {
  activeStop?.();
  useDataSyncStatus.setState({ status: 'saved', error: null });
}

export async function flushCloudSync(): Promise<boolean> {
  if (!activeFlush) return true;
  return activeFlush();
}

export async function retryCloudSync(): Promise<void> {
  await flushCloudSync();
}

export function useCloudSyncStatus(): SyncState {
  return useDataSyncStatus();
}

export function getCloudSyncStatus(): SyncState {
  return useDataSyncStatus.getState();
}
