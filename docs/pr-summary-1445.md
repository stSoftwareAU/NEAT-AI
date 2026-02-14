## Summary

Selective cache invalidation by mutation type in `Creature.ts`. Closes #1445.

Previously, `clearCache()` invalidated ALL caches on any structural change, including `hiddenNeuronUUIDs` — even when only connections changed (not neurons). This caused unnecessary rebuilds of the hidden neuron UUID set during connect/disconnect operations.

### Changes

1. **`clearCache(from, to)` selective path**: No longer clears `hiddenNeuronUUIDs` when called with valid from/to indices (connection-only changes). Adding/removing a connection does not change the set of neurons, so the UUID set remains valid.

2. **`clearConnectionCaches()` private method**: New method for batch connect/disconnect operations that clears all connection-related caches without invalidating `hiddenNeuronUUIDs`.

3. **Redundant `invalidateScoreCache()` removal**: `connect()` and `disconnect()` were calling `invalidateScoreCache()` explicitly after `clearCache()`, but `clearCache()` already calls it internally. Removed the redundant calls.

4. **Updated `connectBatch()`/`disconnectBatch()`**: Now use `clearConnectionCaches()` instead of full `clearCache()` to preserve `hiddenNeuronUUIDs`.

### Files Changed

- `src/Creature.ts` — Selective cache invalidation logic, `clearConnectionCaches()` method, redundant call removal
- `test/creature/SelectiveCacheInvalidation.ts` — 10 new tests for cache preservation behaviour
- `test/Offspring/HiddenNeuronUUIDCache.ts` — Updated test to verify cache preservation (was testing the old unnecessary invalidation)
- `bench/SelectiveCacheInvalidation.ts` — Benchmark showing 100% UUID cache hit rate during connect/disconnect

## Evidence

This is a backend performance change with no UI impact. Benchmark results:

```
Creature: 230 neurons, 11,375 synapses, 175 hidden neurons

hiddenNeuronUUIDs cache preservation:
  100 connect/disconnect ops: 100/100 cache preserved (100% hit rate)
  UUID cache rebuild cost: ~3.17µs per rebuild avoided

Redundant invalidateScoreCache() calls:
  Eliminated 2 duplicate calls per connect()/disconnect() operation
```

## Test Plan

- Added `test/creature/SelectiveCacheInvalidation.ts` with 10 tests:
  - `connect()` preserves `hiddenNeuronUUIDs` cache (reference equality)
  - `disconnect()` preserves `hiddenNeuronUUIDs` cache
  - `connect()` invalidates `connectionSet` correctly
  - `connect()` invalidates `availableConnectionsCache` correctly
  - Full `clearCache()` invalidates everything including `hiddenNeuronUUIDs`
  - `connect()` invalidates score cache
  - `disconnect()` invalidates score cache
  - `connectBatch()` preserves `hiddenNeuronUUIDs` cache
  - `disconnectBatch()` preserves `hiddenNeuronUUIDs` cache
  - Many connect/disconnect cycles preserve `hiddenNeuronUUIDs` on larger creature
- Updated `test/Offspring/HiddenNeuronUUIDCache.ts` to verify new correct behaviour
