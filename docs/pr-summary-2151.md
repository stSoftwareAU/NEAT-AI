## Summary

Clamp unbounded activation function outputs (TAN, SQUARE, CUBE) to prevent
numerical overflow that produced scores like `-8.9e+63`. Closes #2151.

- **TAN**: Output clamped to [-1000, 1000] (consistent with existing derivative
  cap)
- **SQUARE**: Output clamped to [0, 1e6]
- **CUBE**: Output clamped to [-1e6, 1e6] (MAX_INPUT reduced accordingly)
- **Rust WASM** (`squash.rs`): Both `apply_squash` (f32) and `apply_squash_f64`
  (f64) updated with matching clamps for all three functions

The Exponential activation already had this pattern (`x >= 36` clamped to
MAX_SAFE_INTEGER); this PR applies consistent clamping to the remaining
unbounded activations.

## Evidence

All 5234 Deno tests pass (0 failed), including the existing `RangeBounds.ts`
suite which verifies every activation stays within its declared range for
extreme inputs. All 243 Rust tests pass including new clamping tests.

## Test Plan

- Added `test/methods/activations/UnboundedClamp.ts` with 11 tests:
  - TAN: clamped near +pi/2 asymptote, near -pi/2 asymptote, large input, range
    bounds
  - SQUARE: clamped for large positive input, large negative input, range bounds
  - CUBE: clamped for large positive input, large negative input, range bounds
  - Cross-cutting: no activation produces magnitudes >= 1e7 for extreme inputs
- Added 6 Rust tests in `wasm_activation/src/squash.rs`:
  - TAN f32/f64 clamping near asymptotes
  - SQUARE f32/f64 clamping for large inputs
  - CUBE f32/f64 clamping for large positive/negative inputs
