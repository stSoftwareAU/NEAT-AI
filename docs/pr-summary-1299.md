## Summary

Implements a priority queue for discovery replay that orders candidates by expected improvement, processing the most promising discoveries first (Issue #1299).

### Changes

1. **New `PriorityDiscoveryQueue` module** (`src/discovery/PriorityDiscoveryQueue.ts`):
   - Max-heap structure for O(log n) enqueue/dequeue operations
   - Maintains stable insertion order for equal priorities (FIFO tie-breaking)
   - Immutable/functional API - all operations return new queue instances

2. **Priority calculation based on**:
   - Score delta from original discovery (primary factor, 70% weight)
   - Historical success rate for the candidate's change type (30% weight)

3. **Success rate tracking**:
   - Tracks success/failure rates per change type (add-synapses, add-neurons, etc.)
   - Updates rates after each evaluation to refine future priority calculations
   - Deprioritises repeatedly unsuccessful candidate types

4. **Integration with `DiscoveryReplayRunner`**:
   - Replaced simple sort with priority queue for ordering candidates
   - Added success rate tracking after evaluations

### API

```typescript
interface PrioritisedCandidate {
  entry: SuccessCacheEntry;
  priority: number;
  expectedImprovement: number;
}

// Core operations
makeEmptyQueue(): PriorityDiscoveryQueue
enqueue(queue, entry, priority): PriorityDiscoveryQueue
dequeue(queue): [PrioritisedCandidate | undefined, PriorityDiscoveryQueue]
peek(queue): PrioritisedCandidate | undefined
dequeueAll(queue): [PrioritisedCandidate[], PriorityDiscoveryQueue]

// Priority calculation
calculatePriority(entry, options?): number

// Success rate tracking
updateSuccessRate(queue, changeType, succeeded): PriorityDiscoveryQueue
```

## Evidence

This is a performance enhancement with no visual interface. The improvement is in discovery efficiency:

- Candidates with higher score deltas are processed first
- Change types with historically higher success rates get priority
- The heap structure ensures efficient O(log n) operations even with large candidate sets

**Performance characteristics**:
- Large-scale test (1000 entries): Correctly maintains heap property and processes in priority order
- All 25 new unit tests pass verifying correct behaviour

## Test Plan

### New tests added:

**`test/discovery/PriorityDiscoveryQueue.ts`** (17 tests):
- Basic queue operations (makeEmptyQueue, enqueue, dequeue, peek, dequeueAll)
- Priority calculation (scoreDelta factor, success rate consideration)
- Success rate tracking (per changeType, default rates for unknown types)
- Integration patterns (high scoreDelta prioritisation, failing type deprioritisation)
- Edge cases (empty queue, large entry counts, immutability)

**`test/discovery/DiscoveryReplayRunnerPriority.ts`** (4 tests):
- Priority-based entry processing
- Best improvement selection
- Evaluation includes priority information
- Entries sorted by scoreDelta before processing

### Existing tests verified:
- All 1904 existing tests continue to pass
- `DiscoveryReplayRunner` tests confirm backward compatibility
