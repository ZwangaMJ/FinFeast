/**
 * The Environment passed into every engine: everything that would otherwise be
 * read from the outside world (the clock, randomness, id generation). Engines
 * are pure functions of (State, Inputs, Env); only the store shell builds a
 * live Env (see `src/store/systemEnv.ts`).
 */
export type Env = Readonly<{
  /** Local calendar date, yyyy-mm-dd. */
  today: string;
  /** ISO-8601 timestamp for "generated at" fields. */
  now: string;
  /** Seed for any randomised search (the meal planner). */
  seed: number;
  /** Prefix for ids created during one action; ids are `${idPrefix}${n}`. */
  idPrefix: string;
}>;

/** Deterministic id for the n-th entity created within one action. */
export const idFor = (env: Env, n: number) => `${env.idPrefix}${n.toString(36)}`;

/** Same clock and seed, separate id namespace — so composed steps never mint the same id. */
export const scopeEnv = (env: Env, tag: string): Env => ({ ...env, idPrefix: `${env.idPrefix}${tag}-` });

/** A fixed environment, for tests and for replaying an action exactly. */
export const fixedEnv = (today: string, overrides: Partial<Env> = {}): Env => ({
  today,
  now: `${today}T08:00:00.000Z`,
  seed: 1,
  idPrefix: 'id-',
  ...overrides,
});
