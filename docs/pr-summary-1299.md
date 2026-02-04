## Summary

Implements a priority-based discovery replay queue (Issue #1299) that orders candidates by expected improvement, processing the most promising discoveries first.

### Changes

1. **New `PriorityDiscoveryQueue` class** (`src/discovery/PriorityDiscoveryQueue.ts`):
   - Max-heap structure for O(log n) enqueue/dequeue operations
   - Priority scoring based on:
     - Score delta from original discovery (base priority)
     - Historical success rate for similar modification types (boost)
     - Failure counts for deprioritisation of unsuccessful types
   - Support for dynamic priority updates and deprioritisation

2. **Updated `DiscoveryReplayRunner`** to use priority queue when `discoveryReplayPriorityEnabled` is true (default):
   - Calculates success rates per change type from historical entries
   - Uses `calculatePriority()` to rank candidates by expected improvement
   - Includes priority queue diagnostics when `discoveryReplayDiagnostics` is enabled

3. **New configuration option** `discoveryReplayPriorityEnabled`:
   - Defaults to `true` (enabled)
   - Can be disabled to use legacy scoreDelta sorting

## Evidence

### Benchmark Results

```
| benchmark                                                          | time/iter (avg) |
| ------------------------------------------------------------------ | --------------- |
| PriorityDiscoveryQueue: enqueue 1000 entries                       |        571.6 µs |
| PriorityDiscoveryQueue: enqueue and dequeue 1000 entries           |        861.1 µs |
| PriorityDiscoveryQueue: enqueue 100 then dequeue 50                |         62.0 µs |
| calculatePriority: without success rates                           |        382.9 ns |
| calculatePriority: with success rates                              |        429.5 ns |
| calculatePriority: with success rates and failure counts           |        457.6 ns |
| Array.sort: sort 1000 entries by scoreDelta                        |        560.4 µs |
| PriorityDiscoveryQueue: update 100 priorities in 1000-item queue   |        588.8 µs |
| Realistic: replay with 200 entries selecting top 20                |        113.8 µs |
```

The priority queue provides:
- Similar performance to Array.sort for simple top-N selection
- O(log n) dynamic priority updates (not possible with sorted arrays)
- Early termination without sorting entire collection
- Incremental processing capability

### Expected Impact
- Better discoveries found earlier in evolution
- Reduced time on low-value replays
- Adaptive prioritisation based on historical success patterns

## Test Plan

### Unit Tests Added
- `test/discovery/PriorityDiscoveryQueue.ts` - 17 tests covering:
  - Enqueue/dequeue in priority order
  - Peek operation
  - Priority updates
  - Deprioritisation
  - Empty queue handling
  - Duplicate key handling
  - FIFO tie-breaking for equal priorities
  - `calculatePriority()` function with various options

### Integration Tests Added
- `test/discovery/PriorityDiscoveryReplay.ts` - 5 tests covering:
  - Priority queue usage when enabled
  - Fallback to simple sort when disabled
  - Success rate boosting
  - Max singles limit respect
  - Diagnostics recording

### Existing Tests Modified
- `test/discovery/DiscoveryReplayRunnerVerifyScores.ts` - Updated to handle either `sortEntries` or `priorityQueueBuild` timing diagnostic

### Benchmark Added
- `bench/PriorityDiscoveryQueue.ts` - Performance comparison of priority queue vs Array.sort
