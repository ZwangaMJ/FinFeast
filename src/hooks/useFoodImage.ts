import { useEffect, useState } from 'react';

import { createFoodImageResolver, type FoodImageClient, type FoodKind } from '@/lib/foodImages';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import type { FoodImageRef } from '@/store/types';

/** One resolver for the app: dedupes lookups and remembers answers for the session. */
export const foodImageResolver = createFoodImageResolver(() => (isSupabaseConfigured() ? (getSupabaseClient() as unknown as FoodImageClient) : null));

/**
 * The photo for a meal or grocery name. A stored `imageUrl` (on the user's row) wins and
 * skips the lookup. `image` is null while loading and whenever there is no photo
 * (unconfigured, offline, no match), so callers show the emoji.
 */
export function useFoodImage(query: string, kind: FoodKind = 'meal', stored?: FoodImageRef | null): { image: FoodImageRef | null; loading: boolean } {
  const configured = isSupabaseConfigured();
  const skip = !!stored?.url;
  const hit = skip ? stored : foodImageResolver.peek(query, kind);
  const [result, setResult] = useState<{ key: string; image: FoodImageRef | null } | null>(null);
  const key = `${kind}:${query}`;

  useEffect(() => {
    if (skip || !configured || foodImageResolver.peek(query, kind) !== undefined) return;
    let alive = true;
    void foodImageResolver.resolve(query, kind).then((image) => {
      if (alive) setResult({ key: `${kind}:${query}`, image });
    });
    return () => {
      alive = false;
    };
  }, [query, kind, configured, skip]);

  if (hit !== undefined) return { image: hit, loading: false };
  if (!configured) return { image: null, loading: false };
  // Keyed by name so a renamed or swapped item never shows the previous photo.
  if (result?.key === key) return { image: result.image, loading: false };
  return { image: null, loading: true };
}
