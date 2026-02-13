## Summary

Refactored the monolithic `Creature.ts` (3,069 lines) into five focused modules
behind a facade pattern. The `Creature` class is now a thin 719-line facade that
delegates to specialised modules in `src/creature/`. The public API is unchanged
-- all existing imports and method calls work identically. Closes #1409.

### New Module Structure

| Module                    | Lines | Responsibility                                      |
| ------------------------- | ----- | --------------------------------------------------- |
| `CreatureActivation.ts`   | 452   | Forward pass, WASM activation, evaluation           |
| `CreatureTopology.ts`     | 575   | Connection queries, binary search, caching, focus   |
| `CreatureTraining.ts`     | 555   | Training orchestration, evolution, scoring           |
| `CreatureSerialization.ts`| 334   | JSON import/export, cloning                          |
| `CreatureMutation.ts`     | 225   | Network structure repair, random connections         |
| `mod.ts`                  | 67    | Barrel re-export of all module functions             |

### Before vs After

- **Before**: `Creature.ts` was 3,069 lines containing activation, topology,
  training, serialisation, and mutation logic in a single file
- **After**: `Creature.ts` is 719 lines; each extracted module is under 575
  lines with a single responsibility
- **Circular dependencies**: Avoided using `import type` for type-only imports
  (no runtime circular dependency) and dynamic `import()` in `evolveDir()`
- **Public API**: No breaking changes; all methods remain on the `Creature`
  class as thin delegation wrappers

### Design Decisions

- Modules accept `creature: Creature` as the first parameter rather than narrow
  interfaces, since downstream functions (WASM, CreatureUtil, etc.) expect the
  full `Creature` type
- `TopologyCaches` interface holds cache state, passed from the `Creature`
  facade to topology functions
- Focus cache remains separate from topology caches (per Issue #1100)
- `connect()`, `connectBatch()`, `disconnect()`, `disconnectBatch()` remain on
  the `Creature` class since they directly mutate the synapses array and call
  `clearCache()`

## Evidence

This is a pure refactoring with no behavioural changes. All 3,056 existing tests
continue to pass, and 32 new tests verify the extracted module structure.

## Test Plan

- Added `test/creature/CreatureActivation.ts` (7 tests) verifying:
  - WASM eligibility checking
  - WASM disposal lifecycle
  - Consistent activation output
  - Non-finite input rejection
- Added `test/creature/CreatureTopology.ts` (11 tests) verifying:
  - Inward/outward connection queries
  - Binary search and insertion point
  - Self-connection detection
  - Connection set and hidden neuron UUID generation
  - Prebuild inward index
  - Facade delegation consistency
- Added `test/creature/CreatureMutation.ts` (7 tests) verifying:
  - Random connection creation
  - Zero-weight synapse removal
  - Sorted synapses invariant
  - Forward-only version bumping
  - UUID change on structural modification
- Added `test/creature/CreatureSerialization.ts` (7 tests) verifying:
  - JSON export validity
  - Trace JSON generation
  - Round-trip serialisation
  - LoadFrom content replacement
  - Shallow clone independence
- All 3,056 tests pass with `./quality.sh`
