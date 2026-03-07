## Summary

Deduplicate seeded RNG by replacing private LCG implementations with the shared `createSeededRng()` utility. Closes #1722.

Both `BrittlenessScorer.ts` and `HoldoutValidator.ts` contained identical private `createSeededRandom()` functions using a simple LCG (constants `48271`, `2147483647`). These have been replaced with `createSeededRng()` from `src/utils/RandomNumberGenerator.ts`, which provides a higher-quality xoshiro256** PRNG with the same `() => number` interface returning values in [0, 1).

## Evidence

This is a backend-only refactor with no visual output. The change was validated by running `./quality.sh` — all 4586 tests pass, including the existing determinism and statistical behaviour tests for both `BrittlenessScorer` and `HoldoutValidator`.

## Test Plan

- All existing tests in `test/discovery/BrittlenessScorer.ts` continue to pass (deterministic seeding, perturbation bounds, brittleness scoring, threshold rejection)
- All existing tests in `test/discovery/HoldoutValidator.ts` continue to pass (deterministic splitting, holdout percentages, validation, performance gap)
- No new tests needed — the exact random sequence changes but the statistical behaviour and determinism guarantees remain equivalent
