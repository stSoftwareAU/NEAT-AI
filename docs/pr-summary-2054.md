# PR Summary: CreatureExport JSON should not have integer IDs (#2054)

Closes #2054

## Problem

`exportJSON()` included runtime integer IDs (`id` on neurons, `fromId`/`toId`
on synapses) in the external JSON format. These IDs are internal implementation
details that change across generations, machines, and serialisation round-trips.
External consumers relying on them would break silently.

## Solution

Separated the external and internal export formats:

- **`exportJSON()`** now produces UUID-only output (no `id`, `fromId`, `toId`).
  This is the public API for external consumers.
- **`exportInternalJSON()`** (new) produces output with both UUIDs and integer
  IDs. This is for internal hot paths (evolution, training, discovery,
  checkpointing).
- **`exportSnapshotJSON()`** is now equivalent to `exportJSON()` (retained for
  backward compatibility).

## Key Changes

- `CreatureExportBuilder.build(includeIds)` accepts a boolean parameter
  controlling whether integer IDs are emitted (default: `false`).
- `CreatureSerialization.ts` adds `exportInternalJSON()` and
  `buildCreatureExportJSON(creature, includeIds)` helper.
- `Creature.ts` exposes `exportInternalJSON()` as an instance method.
- All ~50 internal `src/` callers migrated from `exportJSON()` to
  `exportInternalJSON()`.
- All ~200 test files updated to use `exportInternalJSON()` where integer IDs
  are accessed.
- Mutation operators (`SubNeuron`, `SubConnection`) and compact utilities
  (`OrphanedNeuronCleanup`, `DeadSubgraphPruning`) updated to call
  `builder.build(true)` since they manipulate integer IDs directly.
- Contract tests updated to verify `exportJSON()` omits integer IDs.
- 9 new dedicated tests in `ExportNoIntegerIds.ts`.

## Testing

All 5086 tests pass. `quality.sh` clean (fmt, lint, type-check, tests).
