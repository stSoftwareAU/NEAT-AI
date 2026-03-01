## Summary

Optimise creature construction by replacing per-connection `connect()` calls
with bulk synapse insertion and replacing the full `fix()` call with targeted
`neuron.fix()` during initialisation. Closes #1643.

### Root cause analysis

Profiling revealed that `fix()` during `initialize()` accounted for **94%** of
fresh construction time. The dominant cost was `CreatureUtil.makeUUID()` being
called **twice** inside `fix()`, each calling `exportJSON()` which serialises
the entire creature structure. For a large creature (520 neurons, 57,000
synapses), each `exportJSON()` call cost ~73 ms.

Additionally, the per-connection `connect()` method performed O(n) insertion
scans and cache invalidation per connection, totalling O(n²) for n connections.

### Changes

**`src/Creature.ts` — `initialize()` method:**

- Replace individual `connect()` calls with direct `Synapse` pushes followed by
  a single `sort()` — avoids O(n) linear scan, `splice()`, and `clearCache()`
  per connection
- Replace full `fix()` call with targeted `neuron.fix()` loop + single
  `makeUUID()` — eliminates duplicate merging, disconnected neuron removal, and
  one of the two `exportJSON()` calls that are unnecessary for fresh
  construction

### Benchmark results

| Creature size                        | Before   | After    | Speedup   |
| ------------------------------------ | -------- | -------- | --------- |
| Small (23 neurons, 115 synapses)     | 280.7 µs | 151.4 µs | **1.85x** |
| Medium (110 neurons, 2,800 synapses) | 6.3 ms   | 3.4 ms   | **1.85x** |
| Large (520 neurons, 57,000 synapses) | 156.7 ms | 84.6 ms  | **1.85x** |

Consistent ~1.85x speedup across all creature sizes. The `fromJSON`
reconstruction path is unaffected (already optimal).

### Profiling breakdown (large creature, pre-optimisation)

| Component                                      | Time        | Percentage |
| ---------------------------------------------- | ----------- | ---------- |
| `fix()` (including 2× `makeUUID`/`exportJSON`) | ~147 ms     | 94%        |
| Neuron + synapse creation                      | ~10 ms      | 6%         |
| **Total**                                      | **~157 ms** | **100%**   |

## Evidence

This is a backend performance change with no UI impact. Evidence is provided via
`Deno.bench()` benchmarks in `bench/CreatureConstruction.ts`.

## Test Plan

- Added `test/CreatureConstruction.ts` with 8 tests covering:
  - Fresh construction validity (with/without layers)
  - Synapse sort order verification
  - Fixed squash assignment
  - Random squash assignment
  - JSON round-trip correctness
  - Large creature construction
  - Activation correctness after construction
- All 4,317 existing tests pass with no regressions
- `./quality.sh` passes cleanly
