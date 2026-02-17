## Summary

Investigated persistent training state in WASM linear memory for issue #1522.
Implementation was completed (Rust training state module, TypeScript wrapper, 12
passing tests, 158 Rust tests) but **benchmarks showed no performance
improvement** — in fact, 2-3x slower than the current approach. Closes #1522 as
a negative result.

## What Was Tried

1. **Rust training state module** (`wasm_activation/src/training_state.rs`):
   Implemented persistent state storage using thread-local `Vec<f64>` buffers
   for synapse state (7 fields × f64) and neuron state (3 fields × f64).
   Functions: `init_training_state`, `reset_training_state`,
   `free_training_state`, `accumulate_weight_persistent_4way/8way`,
   `accumulate_bias_persistent_4way/8way`, `read_synapse_state`,
   `read_neuron_state`, `read_all_synapse_state`, `read_all_neuron_state`.

2. **TypeScript wrapper** (`src/wasm/WasmTrainingState.ts`): Full API with
   pre-allocated buffers, bulk read functions, and unpack helpers.

3. **WASM module integration**: All function pointers wired through
   `WasmModuleLoader.ts`.

## Benchmark Results

```
CPU: Apple M4 Pro | Runtime: Deno 2.6.8

group weight-epoch
| Weight epoch: JS object marshalling (baseline)  |  398.4 µs |
| Weight epoch: Persistent WASM state              |    1.2 ms |
→ Baseline 3.01x faster

group bias-epoch
| Bias epoch: JS object marshalling (baseline)     |  105.7 µs |
| Bias epoch: Persistent WASM state                |  242.5 µs |
→ Baseline 2.29x faster
```

## Why No Gain

The persistent state approach adds overhead rather than removing it because:

1. **Per-call JS→WASM boundary crossing unchanged**: Each accumulation call
   still crosses the boundary to pass input data (weights, targets,
   activations). The persistent state only eliminates the _return_ trip for
   result unpacking.
2. **`RefCell` borrowing overhead**: Rust's `RefCell::borrow_mut()` on every
   call adds runtime cost that exceeds the savings from not returning results.
3. **V8 JIT already optimises the baseline**: TypeScript batch functions with
   pre-allocated typed arrays are highly optimised by V8's JIT compiler, making
   the JS→JS path very fast.
4. **Issue dependency not met**: The issue notes "Should be implemented after
   #1520 (fused backprop inner loop) for maximum benefit." Without the fused
   backprop consuming state entirely within WASM, we still need per-call
   boundary crossings.

## Recommendation

This approach should be **revisited after #1520** (fused backprop inner loop) is
implemented. When the entire backward pass runs inside WASM, the persistent
state would be consumed without any JS/WASM boundary crossings, and the expected
1.5-2x speedup on data transfer overhead could be realised.

A negative result is still a valuable learning — it confirms that eliminating
only the _return_ path of marshalling is insufficient; the _input_ path must
also be eliminated (via fused backprop) for meaningful gains.

## Evidence

- All 12 TypeScript tests pass, confirming numerical equivalence with the
  current approach
- All 158 Rust tests pass, including 9 new training state tests
- Benchmark results above demonstrate the negative outcome

## Test Plan

No PR raised — issue closed as negative result with benchmark evidence.
