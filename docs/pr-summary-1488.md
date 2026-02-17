## Summary

Modernise C-style `for` loops to `for...of` where the loop index is only used
for element access. This improves readability, eliminates off-by-one risk, and
reduces variable pollution across 18 source files. Closes #1488.

Only loops where the index variable was exclusively used as `array[i]` were
converted. Loops where the index is used for multiple array access, assignment
by index, arithmetic, counter-as-data, or in performance-critical WASM/propagation
paths were intentionally left unchanged.

## Changes

- **18 files** modified with **31 fewer lines** of code
- Converted ~25 C-style `for` loops to `for...of` or `for...of` with `.entries()`
- All conversions are behaviour-preserving refactors

### Files modified

| File | Loops converted |
|------|----------------|
| `src/deprecated/MEAN.ts` | 1 |
| `src/architecture/Neuron.ts` | 1 |
| `src/architecture/Offspring.ts` | 1 |
| `src/architecture/ElitismUtils.ts` | 1 |
| `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts` | 1 |
| `src/Creature.ts` | 1 |
| `src/NEAT/Neat.ts` | 2 |
| `src/NEAT/Mutator.ts` | 1 |
| `src/mutate/AddConnection.ts` | 1 |
| `src/compact/CompactUtils.ts` | 1 |
| `src/compact/CompactCreature.ts` | 2 |
| `src/creature/CreatureTopology.ts` | 3 |
| `src/blackbox/Discover.ts` | 4 |
| `src/blackbox/MemeticUpdate.ts` | 2 |
| `src/breed/EditParentByIndex.ts` | 1 |
| `src/breed/FitnessRanking.ts` | 2 |
| `src/methods/activations/aggregate/MAXIMUM.ts` | 1 |
| `src/methods/activations/aggregate/MINIMUM.ts` | 1 |
| `src/optimize/Simplify.ts` | 4 |

## Evidence

This is a purely structural refactor with no visual or performance changes.
All 3859 existing tests pass with `./quality.sh` (lint, format, type-check, tests).

## Test Plan

- No new tests required (behaviour-preserving refactor)
- All 3859 existing tests pass
- `deno fmt`, `deno lint`, and `deno check` all pass cleanly
