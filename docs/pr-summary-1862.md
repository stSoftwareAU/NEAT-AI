## Summary

Add parallel batch creature evaluation with topology-aware grouping and configurable concurrency. Closes #1862.

The Fitness class now supports two key enhancements for population fitness evaluation:

- **Topology-aware grouping** — Before distributing creatures to workers, the evaluation queue is sorted by topology hash. This clusters creatures with identical network structure together, so they naturally flow to the same worker via the work-stealing pattern. Workers benefit from WASM compilation cache hits when evaluating same-topology creatures consecutively.

- **Configurable concurrency** — A new `maxConcurrentEvaluations` setting caps how many workers participate in fitness evaluation, independent of the total thread count. This allows reserving workers for concurrent training/discovery tasks. When set to 0 (default), all workers are used.

Both features are fully backward compatible — the Fitness class works identically to before when no config is provided.

## Configuration

New `parallelEvaluation` config option:

```ts
const config = createNeatConfig({
  parallelEvaluation: {
    maxConcurrentEvaluations: 4, // Cap workers for evaluation (0 = all)
    topologyGrouping: true,      // Group by topology for cache hits
  },
});
```

## Evidence

- All 4720 existing tests pass with no modifications
- 16 new tests verify topology grouping, concurrency limiting, deduplication interaction, backward compatibility, and config parsing
- Benchmark script (`bench/ParallelEvaluation.ts`) compares evaluation with and without topology grouping

## Test Plan

- `test/architecture/BatchCreatureEvaluation.ts` — 8 tests:
  - Topology grouping clusters same-topology creatures on same worker
  - Topology grouping disabled preserves original order
  - maxConcurrentEvaluations limits active workers
  - maxConcurrentEvaluations 0 uses all workers
  - Batch evaluation produces identical results to sequential
  - Backward compatible without config parameter
  - Topology grouping with deduplication
  - Default config has expected values
- `test/config/ParallelEvaluationConfig.ts` — 8 tests:
  - Default values, custom overrides, partial overrides
  - CLI string coercion
  - Validation (maxConcurrentEvaluations >= 0)
  - Config frozen after creation
  - Topology grouping toggle
