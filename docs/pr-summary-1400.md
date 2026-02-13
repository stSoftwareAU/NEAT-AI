# Feature: Add reproducible random number generation with seeding support (#1400)

Closes #1400

## Summary

Replaced all ~79 scattered `Math.random()` calls across the codebase with an
injectable, seedable random number generator. Consumers can now pass a `seed` in
`NeatOptions` for fully deterministic evolution runs, or inject a custom `rng`
instance. Unseeded behaviour (backed by `Math.random()`) is preserved by default
for backward compatibility.

## What Changed

### New Files

- **`src/utils/RandomNumberGenerator.ts`** -- `RandomNumberGenerator` interface
  with `random()`, `randomInt(min, max)`, `choice(array)`, `seeded` property.
  Two implementations: `SeededRng` (xoshiro256** PRNG with SplitMix64
  initialisation) and `UnseededRng` (wraps `Math.random()`). Global instance
  pattern: `getRandomNumberGenerator()`/ `setRandomNumberGenerator()`.
  Factories: `createSeededRng(seed)`, `createUnseededRng()`.
- **`test/utils/RandomNumberGenerator.ts`** -- 21 unit tests covering
  reproducibility, range correctness, uniformity (chi-squared), diversity,
  interleaved operations, edge cases (seed 0, large seed, single-element choice,
  empty array).
- **`test/config/NeatConfigRng.ts`** -- 10 integration tests covering config
  seed parsing (number and string), unseeded default, custom rng precedence,
  global RNG propagation, deterministic config defaults (sparseRatio,
  globalBreedingRate, selection), and reproducible mutation (MOD_WEIGHT and
  MOD_BIAS produce identical results with same seed).

### Config Integration

- **`NeatArguments.ts`** -- Added `rng: RandomNumberGenerator` field.
- **`NeatOptions.ts`** -- Added `seed?: number` and
  `rng?: RandomNumberGenerator` to `NeatOptions`; added `seed?: number | string`
  and `rng?: RandomNumberGenerator` to `NeatOptionsInput` for CLI support. Both
  added to Omit lists.
- **`NeatConfig.ts`** -- Creates RNG at the very top of `createNeatConfig()`
  before any randomness: uses `options.rng` if provided, else
  `createSeededRng(seed)` if seed given, else `createUnseededRng()`. Calls
  `setRandomNumberGenerator()` to propagate globally. Replaced inline
  `Math.random()` for selection, sparseRatio, and globalBreedingRate defaults.
- **`mod.ts`** -- Exports `createSeededRng`, `createUnseededRng`,
  `getRandomNumberGenerator`, `setRandomNumberGenerator`,
  `RandomNumberGenerator` type.

### Math.random() Replacement (38 production files)

Every `Math.random()` call in `src/` was replaced with
`getRandomNumberGenerator().random()` (or equivalent via a local `rng`
variable). Files span mutation operators, breeding, architecture, discovery,
backpropagation, activation functions, optimisation, and blackbox modules.

The only remaining `Math.random()` call in production code is inside
`UnseededRng.random()`, which is the intentional backward-compatible wrapper.

## Evidence

- `quality.sh` passes: formatting, linting, type-checking, all **2822 tests
  pass** with 0 failures.
- Final grep confirms zero remaining production `Math.random()` calls outside
  `RandomNumberGenerator.ts` itself and JSDoc comment blocks.

## Test Plan

- [x] `test/utils/RandomNumberGenerator.ts` -- 21 unit tests for RNG interface,
      xoshiro256** reproducibility, uniformity, edge cases
- [x] `test/config/NeatConfigRng.ts` -- 10 integration tests for config seed/rng
      parsing, global propagation, deterministic mutation
- [x] Full test suite (2822 tests) passes with no regressions
- [x] `deno check` type-checking passes
- [x] `deno fmt --check` formatting passes
- [x] `deno lint` linting passes
