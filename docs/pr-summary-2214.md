## Summary

Fixed the evolution loop crash caused by WASM "RuntimeError: unreachable" panics
under memory pressure. Closes #2214.

The error chain was:
1. WASM panics with "RuntimeError: unreachable" during batch scoring (memory pressure)
2. Worker catches the error and returns `POSITIVE_INFINITY` as the error value
3. Fitness.ts (PR #2212) correctly assigns `-Infinity` score to the affected creature
4. **NeatEvolution.ts crashes** with `AssertionError: Score: -Infinity is not finite`
   because it asserts all scores must be finite

Two fixes applied:
- **NeatEvolution.ts**: Replaced the `Number.isFinite()` assertion with a graceful
  skip — creatures with non-finite scores are excluded from the genus (so natural
  selection removes them) but do not crash the evolution loop.
- **CreatureActivation.ts**: Wrapped the fused WASM batch scoring calls in a
  try-catch so that a WASM panic returns `MAX_SAFE_INTEGER` as the error value
  instead of propagating the exception up to the worker.

## Evidence

The bug was observed in production logs (GRQ-12-nigel.log) where heap usage hit
95.4% (CRITICAL), triggering a WASM panic that crashed the entire evolution process.

## Test Plan

- Added `test/NEAT/EvolveWasmPanicRecovery.ts` with two tests:
  - Verifies that some creatures with `-Infinity` scores are excluded from the genus
    without crashing evolution
  - Verifies that a majority of creatures with `-Infinity` scores still allows
    evolution to continue
- Existing `test/architecture/FitnessWasmPanicRecovery.ts` tests continue to pass
- All 5459 tests pass with 0 failures
