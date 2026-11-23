/**
 * The imperative shell's only window onto the outside world: reads the clock and
 * randomness once per action and hands the engines a plain `Env` value.
 */
import { iso } from '@/lib/dates';
import type { Env } from '@/lib/env';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function systemEnv(): Env {
  const now = new Date();
  return { today: iso(now), now: now.toISOString(), seed: Math.floor(Math.random() * 100000), idPrefix: `${uid()}-` };
}
