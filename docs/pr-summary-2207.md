## Summary

Fix Rust/WASM ownership error that crashes worker threads during cleanup. Closes
#2207.

When a WASM function panics (e.g. `RuntimeError: unreachable` in
`mse_sum_batch_packed`), the wasm-bindgen internal borrow count on the
`CompiledNetwork` pointer is left incremented. When the `finally` block then
calls `Creature.dispose()` → `WasmCreatureActivation.free()` →
`CompiledNetwork.free()`, the WASM destructor detects the dangling borrow and
throws `"attempted to take ownership of Rust value while it was borrowed"`. This
second error replaces the original error, crashing the worker process.

### Changes

1. **Graceful `free()`**: `CompiledNetwork.free()` is now wrapped in try-catch
   so disposal always succeeds, even when the Rust value is in a corrupted
   borrow state.
2. **Immediate invalidation on WASM panic**: All WASM method calls (activate,
   batch scoring, tracing) now catch WASM traps and immediately mark the
   activation as freed, preventing reuse of corrupted WASM state and ensuring
   `free()` becomes a safe no-op.
3. **`callBatchFn()` helper**: All six batch evaluation functions (MSE, MAE,
   Cross-Entropy, MAPE, MSLE, Hinge) consolidated through a DRY helper that
   handles WASM trap recovery.

## Evidence

Reproduced the exact production error from the GRQ-21-sloth log:

- Tests trigger a real WASM trap by calling `mse_sum_batch_packed` with
  `num_outputs=100` on a 3-neuron network, causing a subtraction underflow panic
  in Rust.
- Before the fix, `free()` threw
  `"attempted to take ownership of Rust value
  while it was borrowed"` —
  matching the production error exactly.
- After the fix, `free()` completes silently and the activation is properly
  marked as freed.

## Test Plan

- Added `test/wasm/WasmOwnershipRecovery.ts` with 10 tests covering:
  - Normal disposal: idempotent free, zero after free, Symbol.dispose,
    Creature.dispose, clearState reuse, double dispose
  - WASM trap recovery: free after trap, double free after trap, Symbol.dispose
    after trap, callBatchFn poisoning after trap
- All existing tests continue to pass (5427+ tests)
- All 21 existing `WasmActivationErrors` tests continue to pass
