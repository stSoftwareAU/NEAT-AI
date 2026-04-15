## Summary

Implement targeted performance improvements based on production-scale profiling
from #2307. Two high-impact optimisations validated with before/after benchmarks
at production scale (~1,500 neurons, ~20,000 synapses). Closes #2308.

### Optimisation 1: `makeUUID()` direct string construction (4.0x speedup)

The `CreatureUtil.makeUUID()` method previously called the expensive
`exportJSON()` path to compute a creature's UUID, which at production scale
(~1,500 neurons, ~20,000 synapses) took **18.2 ms** per call. This involved:

- Allocating `NeuronExport` and `SynapseExport` objects for every neuron/synapse
- Building UUID/ID lookup maps
- `JSON.stringify` of the entire creature structure

The optimised version builds the hash string directly from the creature's
internal arrays (similar to the existing `getTopologyHash()` approach), reusing
the cached UUID lookup array where available. This eliminates all intermediate
object allocations and the full JSON serialisation overhead.

**Impact**: At production scale with ~20 offspring per generation, this saves
~274 ms per generation in UUID computation alone.

### Optimisation 2: DeDuplicator `shallowClone()` (18.1x speedup per clone)

The `DeDuplicator.replaceDuplicateCreature()` retry loop previously used
`Creature.fromJSON(creature.exportJSON())` to create clones before mutation. At
production scale, this took **4.7 ms** per clone. The retry loop runs up to 16
times per duplicate, with an additional 10-attempt fallback loop.

Replaced with `creature.shallowClone()` at **0.26 ms** per clone — an **18.1x
speedup**. This was already the established pattern elsewhere in the codebase
(Mutator, Offspring, NeatEvolution) but had not been applied to the
DeDuplicator.

## Evidence

Benchmark results from `bench/MakeUuidOptimisation.ts` on Apple M4, Deno 2.7.12:

| Operation                      | Before  | After   | Speedup   |
| ------------------------------ | ------- | ------- | --------- |
| `makeUUID()` (1500N/20000S)    | 18.2 ms | 4.5 ms  | **4.0x**  |
| DeDuplicator clone (per clone) | 4.7 ms  | 0.26 ms | **18.1x** |

No UI changes — this is a backend performance optimisation.

## Test Plan

- `test/architecture/MakeUuidDirectConstruction.ts` (8 tests):
  - Deterministic UUID generation for same creature
  - Different weights, biases, squash functions produce different UUIDs
  - Tags do not affect UUID
  - Frozen synapses change UUID
  - Cached UUID returned immediately
  - shallowClone preserves UUID

- `test/NEAT/DeDuplicatorShallowClone.ts` (3 tests):
  - shallowClone + mutate produces independent creature with new UUID
  - shallowClone preserves neuron UUIDs for breeding compatibility
  - shallowClone creates structurally independent copy

- All 5,865 existing tests pass with 0 failures
- Updated golden UUID value in `test/creature/CreatureUUID.ts` (expected change
  from algorithm update)
