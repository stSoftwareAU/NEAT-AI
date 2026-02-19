## Summary

Eliminated redundant `.slice().sort()` allocations in the WASM trace path. The
`inwardConnections()` method already returns results sorted by `from` index
through all code paths (secondary index sorted by `(to, from)` and linear scan
iterating `creature.synapses` which is sorted by `(from, to)`), making the
copy-and-sort calls unnecessary. Closes #1536.

Removed `.slice().sort()` from:

- `src/creature/CreatureActivation.ts` — `applyWasmTraceData()` (per-sample
  backprop path)
- `src/wasm/CompileToWasm.ts` — `compileCreatureToWasm()` (compilation path)
- `src/wasm/WasmCompilationCache.ts` — `buildTemplate()` and
  `compileFromTemplate()` (cached compilation path)

## Evidence

Benchmark results on Apple M4 Pro (1001 neurons, 2448 synapses):

```
| benchmark                                               | time/iter (avg) |        iter/s |
| ------------------------------------------------------- | --------------- | ------------- |
| inwardConnections direct iteration (no slice/sort)      |         19.9 µs |        50,260 |
| inwardConnections with .slice().sort() (old approach)   |         77.6 µs |        12,890 |
```

**3.9x speedup** — eliminates O(N) array allocation + sort per neuron per
sample.

This is a backend-only performance change with no visual output.

## Test Plan

- Added `test/InwardConnectionsSorted.ts` with 5 tests verifying
  `inwardConnections()` returns sorted results across all code paths:
  - Direct sorted order verification
  - Prebuilt index path
  - Bulk load path
  - Linear scan fallback path
  - Consistency after cache clear
- Added `bench/InwardSliceSortElimination.ts` benchmark
- All 4154 existing tests pass unchanged
