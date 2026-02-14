## Summary

Replace recursive DFS with iterative BFS in focus cache for improved
performance. Closes #1443.

The `inFocus()` method previously used recursive DFS to check each neuron query
individually, traversing upstream connections and recursively checking
ancestors. This has O(focusList x inwardConnections x recursion depth)
complexity per query.

The new implementation builds the entire focus closure once using iterative BFS,
then stores it as a `Set<number>` for O(1) per-query lookup. The closure is
computed by:

1. Seeding a BFS queue with focus neurons and self-connected neurons
2. Walking downstream via outward connections
3. Adding all reachable neurons to the closure set

The closure is cached and invalidated only when the focus list changes, matching
the existing cache preservation strategy from Issue #1100.

## Evidence

### Benchmark Results

**CPU: Apple M4 Pro | Runtime: Deno 2.6.9**

Creatures tested: Small (25 neurons/150 synapses), Medium (80/1500), Large
(270/15500), Very Large (620/69500).

**Cached lookups vs cache-cleared-each-iteration (100 iterations):**

| Creature Size             | Cached (BFS) | Cache Cleared | Speedup          |
| ------------------------- | ------------ | ------------- | ---------------- |
| Large (~270 neurons)      | 3.0 ms       | 18.3 ms       | **6.11x faster** |
| Very Large (~620 neurons) | 11.7 ms      | 85.0 ms       | **7.29x faster** |

The improvement comes from two sources:

- **Single BFS pass** builds the entire closure instead of per-query recursive
  DFS
- **O(1) Set lookup** for subsequent queries instead of traversing the graph

### Code Changes

- `src/creature/CreatureTopology.ts`: Replaced recursive `inFocus()` with
  iterative BFS via `buildFocusClosure()`. The closure is a `Set<number>` built
  once per focus list.
- `src/Creature.ts`: Updated focus cache from `Map<number, boolean>` to
  `Set<number> | null`. Simplified `inFocus()` API (removed `checked`
  parameter).

## Test Plan

- Added 9 new tests in `test/creature/FocusClosure.ts`:
  - Chain transitive reachability
  - Mid-chain focus (upstream exclusion)
  - Diamond topology
  - Disconnected paths (only focused path included)
  - Multiple focus neurons
  - Empty/undefined focus list
  - Cache invalidation on focus list change
  - Self-connection behaviour preservation
  - Consistency with existing test data
- All 31 existing focus-related tests pass unchanged
- All 3606 project tests pass
- Added benchmark suite in `bench/FocusClosureBFS.ts`
