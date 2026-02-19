## Summary

Replace `CreatureState.nodeMap` (`Map<number, NeuronState>`) with a pre-allocated
flat `NeuronState[]` array for O(1) neuron state access without Map hashing
overhead. Closes #1537.

### Changes

- **`src/architecture/CreatureState.ts`**: Replaced `nodeMap: Map<number, NeuronState>`
  with `nodeArray: NeuronState[]`, pre-allocated to `creature.neurons.length` at
  construction time.
- **`node()`** now uses direct array indexing instead of `Map.get()`.
- **`clear()`** replaces each element with a fresh `NeuronState()` (not in-place
  reset, since external code like `traceJSON` holds references to old objects).
- **`collectNeuronErrors()`** iterates the flat array with a `for` loop instead
  of `Map.entries()`.
- Added `NeuronState.reset()` method for potential future in-place reuse.

### Why not in-place reset?

The `traceJSON()` function in `CreatureSerialization.ts` assigns `NeuronState`
objects by reference to trace exports. If `clear()` mutated those objects in
place, trace data would be corrupted. Creating new objects preserves the
semantics of the original Map-based approach while still gaining the O(1) array
access benefit.

## Evidence

### Benchmark results (5000 iterations per test)

| Neurons | Operation | Before (ms) | After (ms) | Speedup |
|---------|-----------|-------------|------------|---------|
| 115 | node() access | 26.31 | 9.77 | **2.69x** |
| 115 | clear() | 9.33 | 4.47 | **2.09x** |
| 115 | collectErrors | 9.25 | 4.86 | **1.90x** |
| 515 | node() access | 67.78 | 27.56 | **2.46x** |
| 515 | clear() | 49.35 | 15.41 | **3.20x** |
| 515 | collectErrors | 32.80 | 21.56 | **1.52x** |
| 1015 | node() access | 114.50 | 55.53 | **2.06x** |
| 1015 | clear() | 76.78 | 32.41 | **2.37x** |
| 1015 | collectErrors | 73.13 | 53.92 | **1.36x** |

Consistent 1.4x-3.2x improvement across all operations and network sizes.

## Test Plan

- Added `test/architecture/CreatureStateFlatArray.ts` with 5 tests:
  - `node()` returns `NeuronState` for all neuron indices
  - `node()` returns same reference on repeated access
  - `clear()` resets all neuron states to defaults
  - `collectNeuronErrors` iterates all neurons correctly
  - `node()` works after `clear()` and re-access
- All 4159 existing tests pass (including propagation and training tests)
- Added `bench/CreatureStateNodeMap.ts` benchmark
