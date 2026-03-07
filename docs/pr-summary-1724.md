## Summary

Optimise `calculateSquashError()` hot-loop allocations in `DiscoverSquashAnalysis.ts`. Closes #1724.

Two changes:
1. **Module-level MSE instance** — `new MSE()` moved from per-call to a module-level constant since MSE is stateless.
2. **Pre-allocated Float32Array buffers** — Two `Float32Array(1)` buffers are allocated once per call and reused via `buffer[0] = value` instead of creating `Float32Array.from([value])` on every iteration.

## Evidence

Benchmark results on Apple M4 Pro (Deno 2.7.4):

| Array size | Before (avg) | After (avg) | Speedup |
|------------|-------------|-------------|---------|
| n=100      | 26.3 µs     | 403.1 ns    | ~65x    |
| n=1,000    | 256.4 µs    | 2.3 µs      | ~111x   |
| n=10,000   | 2.6 ms      | 23.4 µs     | ~111x   |

No UI changes — this is a pure backend performance optimisation.

## Test Plan

- Added `test/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts` with 6 tests:
  - Returns zero for identical arrays
  - Returns correct MSE for differing arrays
  - Handles single element
  - Throws on undefined activation
  - Consistent results across multiple calls
  - Handles large arrays (n=10,000)
- All 4,586 existing tests pass
- `./quality.sh` passes cleanly
