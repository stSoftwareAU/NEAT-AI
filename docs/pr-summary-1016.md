## Summary

Implements creature topology hashing and fitness evaluation deduplication to prevent redundant fitness evaluations when identical creatures appear in the population.

**Key Changes:**

1. **Topology Hash Function** (`src/architecture/CreatureUtils.ts`):
   - Added `getTopologyHash()` method that generates a hash based on network structure only (neurons, types, squash functions, connection patterns)
   - Excludes weights and biases, enabling identification of structurally identical creatures
   - Uses V5 UUID generation with a dedicated namespace for topology hashes
   - Cached on the creature for performance

2. **Fitness Evaluation Deduplication** (`src/architecture/Fitness.ts`):
   - Modified `calculate()` to deduplicate creatures by UUID before evaluation
   - Creatures with identical UUIDs are grouped together
   - Only one creature per unique UUID is sent to workers for evaluation
   - Scores are automatically copied to all duplicate creatures after evaluation
   - Includes error and score tags in the copy

3. **New Creature Property** (`src/Creature.ts`):
   - Added `topologyHash?: string` property for caching topology hashes

## Evidence

### Performance Benchmark Results

The fitness deduplication benchmark (`test/FitnessDeduplicationBenchmark.ts`) demonstrates the improvement:

```
--- Fitness Deduplication Benchmark Results ---
Population size: 100
Unique creatures: 3
Evaluations performed: 3
Evaluations saved: 97
Savings: 97.0%
------------------------------------------------
```

In scenarios where crossover produces many similar offspring (common in NEAT evolution), this optimisation can significantly reduce evaluation time. The savings scale with the degree of duplication in the population.

**Note**: Actual savings in production depend on the population's diversity. More duplicates = more savings.

## Test Plan

Added comprehensive test coverage:

### Topology Hash Tests (`test/TopologyHash.ts`)
- Basic hash generation
- Same topology with different weights produces same hash
- Different topologies produce different hashes
- Different connection patterns produce different hashes
- Order-independent hashing
- Caching works correctly
- Different squash functions produce different hashes

### Fitness Deduplication Tests (`test/FitnessDeduplication.ts`)
- Deduplicates identical creatures by UUID
- Different creatures are evaluated separately
- Skips creatures that already have scores
- Mixed population with duplicates and uniques

### Benchmark Test (`test/FitnessDeduplicationBenchmark.ts`)
- Measures evaluation savings with a population containing many duplicates
- Verifies at least 90% savings in high-duplication scenarios

All 1353 existing tests continue to pass.

## Related Issue

Fixes #1016 - Performance: Implement creature topology hashing for evaluation deduplication
