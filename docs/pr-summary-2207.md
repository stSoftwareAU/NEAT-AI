## Summary

Fixed WASM ownership error that crashed workers when a WASM function panicked during creature evaluation. Closes #2207.

When a WASM function traps (e.g. `RuntimeError: unreachable`), the Rust wasm-bindgen borrow counter is not decremented, leaving the `CompiledNetwork` in a permanently borrowed state. When the worker's `finally` block calls `creature.dispose()`, `CompiledNetwork.free()` fails with "attempted to take ownership of Rust value while it was borrowed", propagating the error and crashing the worker process.

The fix has two parts:
1. **Graceful `free()`**: `CompiledNetwork.free()` is now wrapped in try-catch so disposal always succeeds, even when the Rust value is in a corrupted borrow state.
2. **Immediate invalidation on WASM panic**: All WASM method calls (activate, batch scoring, tracing) now catch WASM traps and immediately mark the activation as freed, preventing reuse of corrupted WASM state and ensuring `free()` becomes a safe no-op.

## Evidence

The error from the production log has been addressed:
- `RuntimeError: unreachable` in `mse_sum_batch_packed` no longer causes a cascading failure
- `CompiledNetwork.free()` no longer throws when the Rust borrow is stuck
- Worker `finally` blocks can safely dispose creatures after any WASM error

## Test Plan

- Added `test/wasm/WasmOwnershipRecovery.ts` with 6 tests:
  - `free()` is idempotent (multiple calls do not throw)
  - After free, `neurons` and `synapses` return zero
  - `Symbol.dispose` frees without throwing
  - `Creature.dispose()` handles WASM cleanup without throwing
  - `Creature.clearState()` disposes WASM and allows reuse
  - Double `Creature.dispose()` does not throw
- All 5428 existing tests continue to pass
- All 21 existing `WasmActivationErrors` tests continue to pass
