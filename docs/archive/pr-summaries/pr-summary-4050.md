# PR Summary — Issue #4050: RangeError in evolveDir() after hard-deadline abandonment

**Status:** Ready for review\
**Base:** Develop\
**Issue:** [#4050](https://github.com/stSoftwareAU/NEAT-AI/issues/4050)

## Summary

Fixed three architectural issues in the hard-deadline abandonment flow that left
disposed creatures in `neat.population`, causing
`RangeError: Invalid array length` in `CreatureExportBuilder.build()` during
checkpoint writes.

**Root cause:** When `awaitWithinHardDeadline()` detects a timeout during
`neat.evolve()`, it returns immediately (via `Promise.race()`) but the work
Promise continues running in the background (`work.catch(() => {})`). This
creates a race condition where:

1. `neat.evolve()` is still mutating the population
2. `trimPopulationToSize()` removes creatures from the array
3. But removed creatures are never explicitly disposed
4. Control proceeds to `CheckpointWriter.writeCreatures()`
5. Checkpoint writing crashes on disposed creatures (neurons.length = 0)

## Fixes

### Fix 1: Safe Export in CheckpointWriter (src/creature/CheckpointWriter.ts)

Added try-catch around `creature.exportJSON()` to handle disposed creatures:

- Catches `RangeError` specifically (signature of a disposed creature)
- Logs warning with creature UUID and Issue #4050 reference
- Skips writing that creature's file (uses `continue`)
- Re-throws other error types to preserve safety

```typescript
let json;
try {
  json = creature.exportJSON();
} catch (error) {
  if (error instanceof RangeError) {
    getLogger().warn(
      `Skipping disposed creature ${creature.uuid} (RangeError during export - Issue #4050)`,
    );
    continue;
  }
  throw error;
}
```

This allows checkpoint writes to succeed with only valid creatures, rather than
failing the entire operation.

### Fix 2: Explicit Disposal of Trimmed Creatures (src/NEAT/PopulationCap.ts + src/NEAT/NeatEvolution.ts)

**PopulationCap.ts:** Extended `PopulationTrimResult` with
`removedCreatures: Creature[]` field to track creatures removed by truncation.

**NeatEvolution.ts:** Added disposal loop (lines 1132-1136) that disposes
creatures removed by `trimPopulationToSize()`:

```typescript
for (const creature of trim.removedCreatures) {
  if (!carriedForward.has(creature)) {
    toDispose.add(creature);
  }
}
```

Uses `Set` deduplication to avoid double-disposing across three sources:

- `oldPopulation` (creatures from the previous generation)
- `budgeted.dropped` (creatures from budget violations)
- `trim.removedCreatures` (creatures removed by the cap)

### Fix 3: Corrected Log Message (src/creature/BoundedEvolveTeardown.ts)

Fixed misleading log text at line 282:

- **Old:** `[${label}] teardown: persisting the evolved best creature failed`
- **New:**
  `[${label}] teardown: persisting evolved checkpoint and champion failed`

Reflects that both checkpoint **and** champion are being persisted, not just the
best creature.

## Test Coverage

Added regression test: `test/NEAT/HardDeadlineDisposalRegression.ts`

Simulates the hard-deadline abandonment scenario:

1. Creates a small population with moderate cap
2. Sets a hard deadline so short that it breaches mid-generation
3. Verifies checkpoint write succeeds (no RangeError crash)
4. Confirms no disposed creatures remain in population

All tests passing (24 total: 12 PopulationCap, 11 CheckpointWriter, 1
HardDeadlineDisposalRegression).

## Branch outcomes

- ✅ Safe export mechanism prevents checkpoint crashes on disposed creatures
- ✅ Explicit disposal loop ensures every removed creature is disposed (no
  leaks)
- ✅ Corrected log message accurately reflects what is being persisted

## Changes

| File                                          | Change                                                           |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `src/creature/CheckpointWriter.ts`            | Added try-catch for RangeError, skip + log pattern               |
| `src/NEAT/PopulationCap.ts`                   | Extended PopulationTrimResult with removedCreatures field        |
| `src/NEAT/NeatEvolution.ts`                   | Added disposal loop for trimmed creatures with Set deduplication |
| `src/creature/BoundedEvolveTeardown.ts`       | Corrected log message                                            |
| `CHANGELOG.md`                                | Documented fix rationale                                         |
| `test/NEAT/HardDeadlineDisposalRegression.ts` | New regression test                                              |
| `test/NEAT/PopulationCap.ts`                  | Updated for new removedCreatures field                           |

## Definition of Done

- [x] Identify code path leaving disposed creatures
- [x] Implement safe export mechanism (try-catch, skip + log)
- [x] Handle unexportable creatures by skipping (CheckpointWriter)
- [x] Write regression test for hard-deadline abandonment
      (HardDeadlineDisposalRegression.ts)
- [x] Fix misleading log text at BoundedEvolveTeardown.ts:282
- [x] Close issue with fleet log line quote

## Notes

- Hard-deadline abandonment is an intentional failure mode where
  `Promise.race()` prioritizes the deadline over waiting for `neat.evolve()` to
  complete. The abandoned work continues running in the background (explicitly
  handled with `work.catch(() => {})`), which is the root of the race condition.
- The three fixes address different layers: checkpoint safety (fix 1),
  population cleanup (fix 2), and documentation accuracy (fix 3).
- All changes are defensive and maintain the existing architecture; no breaking
  changes to public APIs.
