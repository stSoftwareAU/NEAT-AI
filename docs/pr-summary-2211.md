## Summary

Handle WASM panic errors gracefully in Fitness evaluation. Closes #2211.

When a worker encounters a WASM `RuntimeError: unreachable` (e.g. under critical
memory pressure at 95.9% heap), it returns `POSITIVE_INFINITY` as the evaluation
error value. Previously, `Score.calculate()` would crash with
`AssertionError: Error is not finite`, terminating the entire evolution process.

Now `Fitness.processNext()` detects non-finite or negative error values and assigns
`-Infinity` score to the affected creature, allowing natural selection to remove it
gracefully without crashing. Worker error details are logged as warnings for
diagnostics.

## Evidence

The fix handles the exact crash path observed in the production log
(`GRQ-12-nigel.log`):
1. `[MemoryMonitor] Critical-level response: cleared all WASM caches`
2. `RuntimeError: unreachable` in `mse_sum_batch_packed`
3. Previously: `AssertionError: Error is not finite` (process crash)
4. Now: creature gets `-Infinity` score and is removed by selection

## Test Plan

- Added `test/architecture/FitnessWasmPanicRecovery.ts` with 4 tests:
  - WASM panic (`POSITIVE_INFINITY` error) returns `-Infinity` score
  - `NaN` error returns `-Infinity` score
  - Negative error returns `-Infinity` score
  - Valid error values still score normally (regression guard)
- All 5451 existing tests continue to pass
