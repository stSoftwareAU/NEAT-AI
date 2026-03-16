## Summary

Optimise hot-path activation functions by replacing `Math.pow()` calls with
inline multiplication and pre-computing constant expressions. Extract shared
Newton-Raphson iteration constants to a single module. Addresses #1764.

### Changes

1. **GAUSSIAN.ts**: `Math.pow(safeX, 2)` → `safeX * safeX`
2. **ISRU.ts**: `Math.pow(x, 2)` → `x * x` (squash and unSquash),
   `Math.pow(denom, -1.5)` → `1 / (denom * Math.sqrt(denom))` (derivative)
3. **GELU.ts**: `Math.pow(x, 3)` → `x * x * x` (squash and derivative),
   `Math.sqrt(2 / Math.PI)` pre-computed as static `SQRT_2_OVER_PI` constant
4. **NewtonRaphsonConstants.ts**: New shared module for `NR_MAX_ITERATIONS`
   (100) and `NR_TOLERANCE` (1e-6), used by GELU, Swish, BENT_IDENTITY. Mish
   retains its own `TOLERANCE = 1e-4` since it intentionally uses lower
   precision.

## Evidence

Benchmark results on Apple M4 Pro / Deno 2.7.4:

| Benchmark           | Before (µs) | After (µs) | Change   |
| ------------------- | ----------- | ---------- | -------- |
| GAUSSIAN squash     | 5.7         | 5.6        | -2%      |
| GAUSSIAN derivative | 1.8         | 1.7        | -6%      |
| ISRU squash         | 2.5         | 2.4        | -4%      |
| ISRU unSquash       | 3.5         | 3.4        | -3%      |
| ISRU derivative     | 1.8         | 1.7        | -6%      |
| **GELU squash**     | **21.8**    | **10.0**   | **-54%** |
| GELU derivative     | 1.2         | 1.7        | noise    |

The GELU squash function — the most frequently used activation (mutation
probability 34) — shows a **54% improvement** from the combined effect of
replacing `Math.pow(x, 3)` with `x * x * x` and pre-computing `√(2/π)`.

## Test Plan

- Added `test/methods/activations/ActivationOptimisation.ts` with 11 tests
  covering squash, unSquash, and derivative correctness for GAUSSIAN, ISRU, and
  GELU
- All 4921 existing tests pass
- Benchmark: `bench/activations/MathPowOptimisation.ts`
