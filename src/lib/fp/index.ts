/**
 * Minimal functional toolkit for the FinFeast engines: composition, Result
 * types, a pure seeded RNG and immutable collection helpers. No dependencies,
 * and only erasable TypeScript so it runs under `node --experimental-strip-types`.
 */

// ---------------------------------------------------------------------------
// Immutability

/** Recursively readonly view of a value. Functions pass through unchanged. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

// ---------------------------------------------------------------------------
// Composition

type Fn<A, B> = (a: A) => B;

export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: Fn<A, B>): B;
export function pipe<A, B, C>(a: A, ab: Fn<A, B>, bc: Fn<B, C>): C;
export function pipe<A, B, C, D>(a: A, ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>): D;
export function pipe<A, B, C, D, E>(a: A, ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>): E;
export function pipe<A, B, C, D, E, F>(a: A, ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>, ef: Fn<E, F>): F;
export function pipe<A, B, C, D, E, F, G>(a: A, ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>, ef: Fn<E, F>, fg: Fn<F, G>): G;
export function pipe<A, B, C, D, E, F, G, H>(a: A, ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>, ef: Fn<E, F>, fg: Fn<F, G>, gh: Fn<G, H>): H;
export function pipe(value: unknown, ...fns: readonly Fn<unknown, unknown>[]): unknown {
  return fns.reduce((acc, fn) => fn(acc), value);
}

export function flow<A, B>(ab: Fn<A, B>): Fn<A, B>;
export function flow<A, B, C>(ab: Fn<A, B>, bc: Fn<B, C>): Fn<A, C>;
export function flow<A, B, C, D>(ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>): Fn<A, D>;
export function flow<A, B, C, D, E>(ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>): Fn<A, E>;
export function flow<A, B, C, D, E, F>(ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>, de: Fn<D, E>, ef: Fn<E, F>): Fn<A, F>;
export function flow(...fns: readonly Fn<unknown, unknown>[]): Fn<unknown, unknown> {
  return (value) => fns.reduce((acc, fn) => fn(acc), value);
}

// ---------------------------------------------------------------------------
// Result

export type Ok<T> = Readonly<{ ok: true; value: T }>;
export type Err<E> = Readonly<{ ok: false; error: E }>;
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const mapResult =
  <T, U>(f: (t: T) => U) =>
  <E>(r: Result<T, E>): Result<U, E> =>
    r.ok ? ok(f(r.value)) : r;

export const andThen =
  <T, U, E2>(f: (t: T) => Result<U, E2>) =>
  <E1>(r: Result<T, E1>): Result<U, E1 | E2> =>
    r.ok ? f(r.value) : r;

export const mapErr =
  <E, F>(f: (e: E) => F) =>
  <T>(r: Result<T, E>): Result<T, F> =>
    r.ok ? r : err(f(r.error));

export const unwrapOr =
  <T>(fallback: T) =>
  <E>(r: Result<T, E>): T =>
    r.ok ? r.value : fallback;

export function matchResult<T, E, R>(r: Result<T, E>, cases: Readonly<{ ok: (t: T) => R; err: (e: E) => R }>): R {
  return r.ok ? cases.ok(r.value) : cases.err(r.error);
}

// ---------------------------------------------------------------------------
// Pure seeded random numbers (mulberry32), threaded as explicit state

export type Rng = Readonly<{ state: number }>;

export const seedRng = (seed: number): Rng => ({ state: seed >>> 0 });

/** Returns a float in [0, 1) and the next generator state; never mutates `rng`. */
export function nextFloat(rng: Rng): readonly [number, Rng] {
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  const a = Math.imul(state ^ (state >>> 15), state | 1);
  const b = a ^ (a + Math.imul(a ^ (a >>> 7), a | 61));
  return [((b ^ (b >>> 14)) >>> 0) / 4294967296, { state }];
}

// ---------------------------------------------------------------------------
// Numbers & collections

export const clamp = (lo: number, hi: number) => (n: number) => Math.min(hi, Math.max(lo, n));
export const clamp01 = clamp(0, 1);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
export const sumBy =
  <T>(f: (t: T) => number) =>
  (xs: readonly T[]) =>
    xs.reduce((a, x) => a + f(x), 0);
export const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : 0);
export const stdDev = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export const range = (n: number): readonly number[] => Array.from({ length: Math.max(0, n) }, (_, i) => i);

/** Running fold that keeps every intermediate accumulator (like Array.reduce, but all steps). */
export function scan<T, A>(xs: readonly T[], f: (acc: A, x: T, i: number) => A, initial: A): readonly A[] {
  return xs.reduce<readonly A[]>((out, x, i) => [...out, f(out.length ? out[out.length - 1] : initial, x, i)], []);
}

export const filterBy =
  <T>(pred: (t: T) => boolean) =>
  (xs: readonly T[]): readonly T[] =>
    xs.filter(pred);

export const mapBy =
  <T, U>(f: (t: T, i: number) => U) =>
  (xs: readonly T[]): readonly U[] =>
    xs.map(f);

export const sortBy =
  <T>(compare: (a: T, b: T) => number) =>
  (xs: readonly T[]): readonly T[] =>
    [...xs].sort(compare);

/** Minimum element by key; undefined for an empty list. */
export function minBy<T>(xs: readonly T[], key: (t: T) => number): T | undefined {
  return xs.reduce<T | undefined>((best, x) => (best === undefined || key(x) < key(best) ? x : best), undefined);
}

export const all =
  <T>(...preds: readonly ((t: T) => boolean)[]) =>
  (t: T) =>
    preds.every((p) => p(t));

/** Returns a copy of a record with one key replaced. */
export const assoc = <V>(rec: Readonly<Record<string, V>>, key: string, value: V): Readonly<Record<string, V>> => ({ ...rec, [key]: value });
