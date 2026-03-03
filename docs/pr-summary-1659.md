## Summary

Replace string-keyed `connectionSet: Set<string>` with numeric keys `connectionSet: Set<number>` in the topology cache. The key encoding `from * neuronCount + to` avoids string allocation (integer-to-string conversion, concatenation, and string hashing) on every connection lookup. Closes #1659.

This follows the same pattern already used in Issue #1644 (crossover in `Offspring.ts`).

## Changes

- `src/creature/CreatureTopology.ts`: Changed `connectionSet` from `Set<string>` to `Set<number>`, updated `getConnectionSet()`, `hasConnection()`, and `computeAvailableConnections()` to use numeric key encoding `from * neuronCount + to`
- `src/Creature.ts`: Updated `getConnectionSet()` facade return type from `Set<string>` to `Set<number>`
- `test/mutate/AddConnectionOptimisation.ts`: Updated tests that directly referenced string connection keys to use numeric keys
- `bench/NumericConnectionKeys.ts`: New benchmark measuring `hasConnection()`, `getAvailableConnections()`, and `connectionSet` build across creature sizes (~50, ~200, ~500 neurons)

## Evidence — Benchmark Results

| Benchmark | Before (string) | After (numeric) | Improvement |
|---|---|---|---|
| **hasConnection** (~50 neurons, 1000 lookups) | 86.3 µs | 51.7 µs | **40% faster** |
| **hasConnection** (~200 neurons, 1000 lookups) | 1.6 ms | 1.1 ms | **31% faster** |
| **hasConnection** (~500 neurons, 1000 lookups) | 11.8 ms | 7.8 ms | **34% faster** |
| **getAvailableConnections** (~50 neurons, uncached) | 131.0 µs | 50.3 µs | **62% faster** |
| **getAvailableConnections** (~200 neurons, uncached) | 3.1 ms | 1.4 ms | **55% faster** |
| **getAvailableConnections** (~500 neurons, uncached) | 27.4 ms | 10.9 ms | **60% faster** |
| **connectionSet build** (~50 neurons) | 71.3 µs | 42.1 µs | **41% faster** |
| **connectionSet build** (~200 neurons) | 1.6 ms | 1.1 ms | **31% faster** |
| **connectionSet build** (~500 neurons) | 12.7 ms | 7.9 ms | **38% faster** |

All improvements are well above the 10% threshold specified in the acceptance criteria.

## Test Plan

- All 4334 existing tests pass (`./quality.sh`)
- Updated tests in `test/mutate/AddConnectionOptimisation.ts` to verify numeric key encoding
- Existing tests for `hasConnection`, `getConnectionSet`, `getAvailableConnections`, and cache invalidation all pass without modification (they test behaviour, not key format)
