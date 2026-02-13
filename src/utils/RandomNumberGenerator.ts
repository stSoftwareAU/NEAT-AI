/**
 * Reproducible random number generation with seeding support.
 *
 * Issue #1400: Provides a seedable PRNG (xoshiro256**) so that evolution
 * runs can be reproduced exactly when the same seed is supplied.
 *
 * The module follows the same global-instance pattern as Logger (Issue #1398):
 * - `getRandomNumberGenerator()` returns the active RNG instance
 * - `setRandomNumberGenerator(rng)` replaces the global instance
 * - `createSeededRng(seed)` creates a seeded (deterministic) instance
 * - `createUnseededRng()` creates an unseeded instance backed by `Math.random()`
 *
 * All code that previously called `Math.random()` should instead call
 * `getRandomNumberGenerator().random()`.
 */

/**
 * Random number generator interface.
 *
 * Provides the core random operations used throughout the NEAT-AI codebase.
 */
export interface RandomNumberGenerator {
  /**
   * Returns a pseudo-random number in [0, 1), like `Math.random()`.
   */
  random(): number;

  /**
   * Returns a pseudo-random integer in [min, max] (inclusive).
   */
  randomInt(min: number, max: number): number;

  /**
   * Returns a random element from the given array.
   * Throws if the array is empty.
   */
  choice<T>(array: readonly T[]): T;

  /**
   * Whether this RNG was created with a deterministic seed.
   */
  readonly seeded: boolean;
}

// ─── xoshiro256** implementation ────────────────────────────────────────────
//
// A fast, high-quality 64-bit PRNG. We operate on pairs of 32-bit values
// (hi/lo) because JavaScript lacks native 64-bit integers. The state is
// four 64-bit words (eight 32-bit values).

/** A 64-bit value stored as two 32-bit halves. */
interface U64 {
  hi: number;
  lo: number;
}

function u64(hi: number, lo: number): U64 {
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function u64Add(a: U64, b: U64): U64 {
  const lo = (a.lo + b.lo) >>> 0;
  const carry = lo < a.lo ? 1 : 0;
  const hi = (a.hi + b.hi + carry) >>> 0;
  return { hi, lo };
}

function u64Mul(a: U64, b: U64): U64 {
  // Schoolbook multiply keeping only the lower 64 bits.
  const a0 = a.lo & 0xFFFF;
  const a1 = a.lo >>> 16;
  const a2 = a.hi & 0xFFFF;
  const a3 = a.hi >>> 16;
  const b0 = b.lo & 0xFFFF;
  const b1 = b.lo >>> 16;
  const b2 = b.hi & 0xFFFF;
  const b3 = b.hi >>> 16;

  let lo = 0;
  let hi = 0;

  lo = a0 * b0;
  let mid = (lo >>> 16) + a1 * b0;
  mid += a0 * b1;
  if (mid > 0xFFFF_FFFF) mid = mid >>> 0; // wrap
  lo = (lo & 0xFFFF) | ((mid & 0xFFFF) << 16);
  hi = (mid >>> 16) + a2 * b0 + a1 * b1 + a0 * b2;
  hi += (a3 * b0 + a2 * b1 + a1 * b2 + a0 * b3) << 16;

  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function u64Xor(a: U64, b: U64): U64 {
  return { hi: (a.hi ^ b.hi) >>> 0, lo: (a.lo ^ b.lo) >>> 0 };
}

function u64ShiftLeft(v: U64, n: number): U64 {
  if (n === 0) return v;
  if (n >= 64) return u64(0, 0);
  if (n >= 32) return u64((v.lo << (n - 32)) >>> 0, 0);
  return u64(((v.hi << n) | (v.lo >>> (32 - n))) >>> 0, (v.lo << n) >>> 0);
}

function u64ShiftRight(v: U64, n: number): U64 {
  if (n === 0) return v;
  if (n >= 64) return u64(0, 0);
  if (n >= 32) return u64(0, (v.hi >>> (n - 32)) >>> 0);
  return u64((v.hi >>> n) >>> 0, ((v.lo >>> n) | (v.hi << (32 - n))) >>> 0);
}

function u64RotateLeft(v: U64, n: number): U64 {
  const left = u64ShiftLeft(v, n);
  const right = u64ShiftRight(v, 64 - n);
  return u64Xor(left, right);
}

/** Convert a 64-bit value to a floating-point number in [0, 1). */
function u64ToFloat(v: U64): number {
  // Use the upper 53 bits: take all 32 of hi and the upper 21 of lo.
  // This gives a 53-bit integer which we divide by 2^53.
  const hi32 = v.hi >>> 0;
  const lo21 = (v.lo >>> 11) >>> 0; // upper 21 bits of lo
  // hi32 * 2^21 + lo21, then divide by 2^53
  return (hi32 * 2_097_152 + lo21) / 9_007_199_254_740_992;
}

/**
 * SplitMix64 — used only to initialise the xoshiro256** state from a
 * single 64-bit seed. This ensures all four state words are non-zero.
 */
function splitMix64(seed: U64): { value: U64; next: U64 } {
  const s = u64Add(seed, u64(0x9E37_79B9, 0x7F4A_7C15));
  let z = s;
  z = u64Xor(z, u64ShiftRight(z, 30));
  z = u64Mul(z, u64(0xBF58_476D, 0x1CE4_E5B9));
  z = u64Xor(z, u64ShiftRight(z, 27));
  z = u64Mul(z, u64(0x94D0_49BB, 0x1331_11EB));
  z = u64Xor(z, u64ShiftRight(z, 31));
  return { value: z, next: s };
}

/**
 * xoshiro256** state: four 64-bit words.
 */
interface Xoshiro256State {
  s0: U64;
  s1: U64;
  s2: U64;
  s3: U64;
}

function xoshiroNext(state: Xoshiro256State): number {
  // result = rotl(s1 * 5, 7) * 9
  const result = u64Mul(
    u64RotateLeft(u64Mul(state.s1, u64(0, 5)), 7),
    u64(0, 9),
  );

  const t = u64ShiftLeft(state.s1, 17);

  state.s2 = u64Xor(state.s2, state.s0);
  state.s3 = u64Xor(state.s3, state.s1);
  state.s1 = u64Xor(state.s1, state.s2);
  state.s0 = u64Xor(state.s0, state.s3);

  state.s2 = u64Xor(state.s2, t);
  state.s3 = u64RotateLeft(state.s3, 45);

  return u64ToFloat(result);
}

function initState(seed: number): Xoshiro256State {
  // Ensure seed is a safe integer
  const safeSeed = Math.abs(Math.trunc(seed)) || 1;
  let s = u64(0, safeSeed);

  const r0 = splitMix64(s);
  s = r0.next;
  const r1 = splitMix64(s);
  s = r1.next;
  const r2 = splitMix64(s);
  s = r2.next;
  const r3 = splitMix64(s);

  return { s0: r0.value, s1: r1.value, s2: r2.value, s3: r3.value };
}

// ─── Concrete implementations ───────────────────────────────────────────────

class SeededRng implements RandomNumberGenerator {
  readonly seeded = true;
  private state: Xoshiro256State;

  constructor(seed: number) {
    this.state = initState(seed);
  }

  random(): number {
    return xoshiroNext(this.state);
  }

  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  choice<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error("Cannot choose from an empty array");
    }
    return array[this.randomInt(0, array.length - 1)];
  }
}

class UnseededRng implements RandomNumberGenerator {
  readonly seeded = false;

  random(): number {
    return Math.random();
  }

  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  choice<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error("Cannot choose from an empty array");
    }
    return array[this.randomInt(0, array.length - 1)];
  }
}

// ─── Global instance ────────────────────────────────────────────────────────

/** The active global RNG instance. Starts unseeded for backward compatibility. */
let globalRng: RandomNumberGenerator = new UnseededRng();

/**
 * Returns the currently active random number generator.
 *
 * All NEAT-AI code should call this instead of `Math.random()`.
 */
export function getRandomNumberGenerator(): RandomNumberGenerator {
  return globalRng;
}

/**
 * Replaces the global random number generator.
 *
 * Called by `createNeatConfig()` when a seed is provided.
 */
export function setRandomNumberGenerator(rng: RandomNumberGenerator): void {
  globalRng = rng;
}

/**
 * Creates a deterministic RNG seeded with the given value.
 *
 * Two instances created with the same seed will produce identical sequences.
 *
 * @param seed - A non-negative integer seed value.
 */
export function createSeededRng(seed: number): RandomNumberGenerator {
  return new SeededRng(seed);
}

/**
 * Creates an unseeded RNG backed by `Math.random()`.
 *
 * This is the default behaviour for backward compatibility.
 */
export function createUnseededRng(): RandomNumberGenerator {
  return new UnseededRng();
}
