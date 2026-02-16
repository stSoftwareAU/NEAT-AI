## Summary

Replace unnecessary JSON serialisation round-trip in `populatePopulation()` with
`shallowClone()`. Closes #1474.

The `populatePopulation()` method in `Neat.ts` was using
`Creature.fromJSON(creature.exportJSON())` to clone creatures when filling the
initial population. This performs a full JSON export (building export objects
with UUID lookups) followed by a full JSON import (parsing, neuron/synapse
reconstruction, sorting). Since the clone stays in the same process and never
crosses a worker boundary, `shallowClone()` achieves the same result without the
serialisation overhead.

The other `exportJSON()`/`fromJSON()` call sites identified in the issue (lines
667, 676, 726) are worker communication paths that **require** serialisation to
produce JSON strings — these cannot be replaced with `shallowClone()`.

## Evidence

Benchmark results (`deno bench bench/PopulatePopulationClone.ts`):

| Creature size | Neurons | Synapses | JSON clone (baseline) | shallowClone (optimised) | Speedup   |
| ------------- | ------- | -------- | --------------------- | ------------------------ | --------- |
| Small         | 35      | 300      | 56.5 µs               | 43.6 µs                  | **1.30x** |
| Medium        | 210     | 10,500   | 1.6 ms                | 1.2 ms                   | **1.33x** |
| Large         | 470     | 46,000   | 7.5 ms                | 5.7 ms                   | **1.31x** |

The improvement is consistent across creature sizes, with ~30% reduction in
clone time. For a typical population of 150 creatures, this saves ~60ms (medium)
to ~270ms (large) during population initialisation.

## Test Plan

- Added `test/NEAT/NeatPopulateShallowClone.ts` with 3 tests:
  - Clones validate correctly after population
  - Clones can be exported and re-imported (round-trip integrity)
  - Clones are independent of seed creature (no shared references)
- All 6 existing `test/NEAT/NeatPopulatePopulation.ts` tests pass
- All 3826 tests pass via `quality.sh`
- Added `bench/PopulatePopulationClone.ts` benchmark
