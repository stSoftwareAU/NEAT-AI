## Summary

Replaced `Creature.fromJSON(creature.exportJSON())` with `creature.shallowClone()` in `Mutator.mutate()` for cloning the original creature before mutation. This avoids expensive JSON serialisation/deserialisation when creating the backup used for memetic updates and discovery. Closes #1586.

## Evidence

Benchmark results (`deno bench bench/MutatorClone.ts`) on Apple M4 Pro:

| Creature Size | Neurons | Synapses | JSON Clone (baseline) | shallowClone | Speedup |
|---|---|---|---|---|---|
| Small | 35 | 300 | 21.8 us | 9.2 us | **2.37x** |
| Medium | 210 | 10,500 | 1.0 ms | 283.6 us | **3.54x** |
| Large | 470 | 46,000 | 5.0 ms | 1.6 ms | **3.13x** |

The `shallowClone()` approach is consistently 2-3.5x faster across all creature sizes.

## Test Plan

- Added `test/NEAT/MutatorShallowClone.ts` with 5 tests verifying:
  - Mutating creatures with score and memetic data preserves behaviour
  - `shallowClone()` preserves score property (no separate assignment needed)
  - `shallowClone()` preserves memetic data for the original backup
  - `shallowClone()` produces structurally equivalent creatures (same UUID as JSON clone)
- All 4361 existing tests pass with no modifications
- Added `bench/MutatorClone.ts` benchmark for before/after comparison
