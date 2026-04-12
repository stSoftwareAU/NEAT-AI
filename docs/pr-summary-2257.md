## Summary

Avoid duplicate `exportJSON()` in the fitness evaluation path by computing
topology hash directly from internal creature structures. Closes #2257.

Previously, `CreatureUtil.getTopologyHash()` called `creature.exportJSON()` to
build the full creature JSON (including weights, biases, tags, frozen flags),
then immediately discarded most of it to extract just the topology fields
(neuron UUIDs/types/squashes and synapse connection pairs). This meant each
creature paid for two full `exportJSON()` calls per fitness evaluation: once for
topology sorting, once for worker postMessage.

The optimisation builds the index-to-UUID map and topology data directly from
the creature's internal neuron and synapse arrays, skipping the intermediate
full `NeuronExport`/`SynapseExport` object allocations entirely.

## Benchmark Results

Benchmarked on Apple M2 Ultra, Deno 2.7.12. Creatures of three sizes tested:
small (23 neurons, 115 synapses), medium (110 neurons, 2800 synapses), large
(520 neurons, 57000 synapses).

### Isolated getTopologyHash (uncached)

| Size   | OLD (via exportJSON) | NEW (direct) | Speedup |
| ------ | -------------------: | -----------: | ------: |
| Small  |             157.4 us |     122.7 us |   1.28x |
| Medium |               9.2 ms |       6.8 ms |   1.36x |
| Large  |             381.1 ms |     130.8 ms |   2.91x |

### Full fitness path (topology hash + evaluate exportJSON)

| Size   | OLD (dual export) | NEW (direct + single) | Speedup |
| ------ | ----------------: | --------------------: | ------: |
| Small  |          179.3 us |              155.4 us |   1.15x |
| Medium |            5.5 ms |                5.4 ms |   1.02x |
| Large  |          197.3 ms |              137.4 ms |   1.44x |

The improvement scales with creature size because the savings from avoiding
57,000 full `SynapseExport` allocations (each with weight, type, frozen, tags
fields) compound with GC pressure reduction.

## Evidence

This is a backend performance change with no UI. Evidence is the benchmark
output above and the test results below.

## Test Plan

- Added `test/architecture/TopologyHashDirectCompute.ts` with 5 tests verifying
  the optimised direct-computation path produces identical hashes to the old
  export-based reference implementation across:
  - Simple creature
  - Multi-layer creature
  - Constant neurons
  - Large constructed creature (20 inputs, 10 outputs, 50+30 hidden layers)
  - Multiple outputs
- All 7 existing `test/architecture/TopologyHash.ts` tests pass unchanged
- Full quality gate passes: 5728 tests, 0 failures
- Added `bench/ExportJsonTopologyReuse.ts` benchmark for ongoing regression
  tracking
