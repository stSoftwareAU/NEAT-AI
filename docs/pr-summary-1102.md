## Summary

Added batch synapse operations (`connectBatch()` and `disconnectBatch()`) to the `Creature` class to reduce cache invalidation overhead. Previously, operations that modified multiple synapses (like breeding) would call `clearCache()` and `invalidateScoreCache()` after each individual synapse change, causing redundant cache rebuilding.

The new batch methods:
- **`connectBatch()`**: Adds multiple synapses with a single cache invalidation
- **`disconnectBatch()`**: Removes multiple synapses with a single cache invalidation

Updated `Offspring.breed()` to use `connectBatch()` instead of individual `connect()` calls.

## Evidence

### Benchmark Results

Performance comparison between batch operations and individual operations:

**connectBatch() vs individual connect():**

| Creature Size | Connections | Individual | Batch | Improvement |
|---------------|-------------|------------|-------|-------------|
| Small (35 neurons) | 50 | 52.8 µs | 16.7 µs | **3.17x faster** |
| Medium (120 neurons) | 200 | 844.9 µs | 76.4 µs | **11.06x faster** |
| Large (270 neurons) | 500 | 6.6 ms | 425.4 µs | **15.57x faster** |

**disconnectBatch() vs individual disconnect():**

| Creature Size | Disconnections | Individual | Batch | Improvement |
|---------------|----------------|------------|-------|-------------|
| Small | 30 | 13.6 µs | 11.9 µs | 1.14x faster |
| Medium | 100 | 57.6 µs | 52.4 µs | 1.10x faster |
| Large | 250 | 409.5 µs | 397.7 µs | 1.03x faster |

The `connectBatch()` improvement significantly exceeds the issue's expected 30-50% improvement, achieving up to **15.57x faster** performance for large creatures. The `disconnectBatch()` improvement is more modest because disconnect operations were already optimised with binary search (Issue #1101).

### Benchmark Command

```bash
deno bench --allow-read --allow-write bench/BatchSynapseOperations.ts
```

## Test Plan

Added 16 unit tests in `test/mutate/BatchSynapseOperations.ts`:

**connectBatch() tests:**
- `connectBatch(): adds multiple synapses in a single operation`
- `connectBatch(): maintains correct synapse ordering`
- `connectBatch(): handles empty array`
- `connectBatch(): handles single connection`
- `connectBatch(): supports synapse types`
- `connectBatch(): throws on duplicate connections within batch`
- `connectBatch(): throws on existing connections`

**disconnectBatch() tests:**
- `disconnectBatch(): removes multiple synapses in a single operation`
- `disconnectBatch(): maintains correct synapse ordering`
- `disconnectBatch(): handles empty array`
- `disconnectBatch(): handles single disconnection`
- `disconnectBatch(): silently ignores non-existent connections`
- `disconnectBatch(): handles mix of existent and non-existent connections`

**Integration tests:**
- `connectBatch() + disconnectBatch(): work together correctly`
- `batch operations: produce same result as individual operations`
- `batch operations: large creature stress test`

All existing tests (1493) continue to pass with the changes.

## Files Changed

- `src/Creature.ts` - Added `connectBatch()`, `disconnectBatch()`, and `findInsertionPoint()` methods
- `src/architecture/Offspring.ts` - Updated breeding to use `connectBatch()`
- `bench/BatchSynapseOperations.ts` - New benchmark file
- `test/mutate/BatchSynapseOperations.ts` - New test file

## Related Issues

- Fixes #1102
- Related to #1090 (Find potential performance improvements in the evolution process)
- Builds on #1101 (Binary search for disconnect operations)
- Builds on #1093 (splice() for connect operations)
