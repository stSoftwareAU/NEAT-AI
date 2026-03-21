## Summary

Implement `generateSyntheticSynapses()` to create temporary zero-weight
synapses between all neuron pairs in adjacent layers, enabling dense
inter-layer connectivity for backpropagation training. Closes #1921.

The function:

- Uses `computeLayerAssignments()` to determine neuron layers
- Creates zero-weight synapses from every neuron in layer N to every neuron
  in layer N+1 for all adjacent layer pairs
- Skips existing connections (no duplicates)
- Skips constant neurons and frozen neurons as targets
- Uses `connectBatch()` for efficient O(n log n) bulk insertion
- Returns both the count of added synapses and a `Set<string>` of
  `"from-to"` keys for tracking/cleanup

## Evidence

All 15 new unit tests pass, covering:

- Simple chain topologies (no missing connections)
- Multi-input/multi-hidden layer connectivity
- Duplicate prevention (no duplicates created)
- Constant neuron exclusion
- Frozen neuron exclusion (both hidden and output)
- Zero-weight verification on all synthetic synapses
- Synthetic key tracking and correctness
- Multi-layer deep topologies
- Direct input-to-output (no hidden neurons)
- Wide layers with many connections
- Idempotency (running twice adds nothing new)
- Input neurons are never targeted

Full quality gate passes: 4,809 tests (including 15 new), lint, fmt,
type-check all clean.

## Test Plan

- Added `test/propagate/SyntheticSynapses.ts` with 15 tests covering all
  acceptance criteria from the issue
