## Summary

Fix creature JSON files being written to disk without a valid `semanticVersion`,
which caused the GRQ worker to abort (GRQ #1740). Closes #2349.

### Root cause

An empty string `""` in `semanticVersion` propagated through `fromJSON` and the
`Creature` constructor without being caught. The constructor treated `""` as a
valid provided value (it is not `undefined`), `loadFrom` skipped it (falsy), and
`writeCreatures` wrote whatever `exportJSON()` returned — including the empty
version.

### Fix (defence in depth at four layers)

1. **`Creature` constructor** — treat empty string as missing; default to
   `CURRENT_CREATURE_SEMANTIC_VERSION` (`"4.0.0"`).
2. **`fromJSON`** — skip `upgradeOne` for empty/falsy versions (an empty version
   is not a genuine `0.x` legacy creature); pass `undefined` to constructor so
   it defaults correctly.
3. **`writeCreatures`** — validate every creature's version before writing; heal
   any invalid version (empty, undefined, or pre-2.x) to the current default;
   assert after export.
4. **`CreatureExportBuilder.build()`** — fallback to
   `CURRENT_CREATURE_SEMANTIC_VERSION` if `creature.semanticVersion` is falsy.

### New files

- `src/upgrade/SemanticVersionValidation.ts` — validation utility
  (`isValidWriteableSemanticVersion`, `assertValidWriteableSemanticVersion`)
  with regex `^([2-9]|[1-9][0-9]+)\.[0-9]+\.[0-9]+$`.

## Evidence

Bug fix with no UI — verified by regression tests and existing test suite:

- 17 new tests in `test/creature/SemanticVersionWriteGuard.ts` all pass
- 12 existing `SemanticVersionStability.ts` tests pass
- 14 upgrade tests pass
- All non-WASM creature tests pass (WASM unavailable on this build machine —
  pre-existing)

## Test Plan

- `test/creature/SemanticVersionWriteGuard.ts` — 17 tests covering:
  - Validation utility: empty, undefined, 0.x, 1.x, 2.x+, non-semver strings
  - `fromJSON` with empty and undefined `semanticVersion` → defaults to current
  - Constructor with empty `semanticVersion` → defaults to current
  - `exportJSON` always includes valid version after `fromJSON("")`
  - Round-trip stability: `fromJSON("")` → `exportJSON` → `fromJSON` preserves
    valid version
