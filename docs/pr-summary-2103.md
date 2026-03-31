## Summary

GRQ v1 model `USDGBP.json.unfixable` contains unresolved git merge/stash
conflict markers (`<<<<<<< Updated upstream` / `=======` /
`>>>>>>> Stashed
changes`), causing `JSON.parse()` to fail with a
`JSONParseError` before any creature loading or `fix()` can run.

This PR adds:

1. **`stripMergeConflictMarkers(text)`** (`src/utils/MergeConflictCleaner.ts`) -
   a utility that resolves git merge conflict markers by keeping the "theirs"
   side (the section between `=======` and `>>>>>>>`), which typically contains
   the newer format with UUIDs. Throws if a conflict block is opened but never
   closed.

2. **`Creature.fromPersistedText(text)`** - a new static method on `Creature`
   that cleans raw JSON text via `stripMergeConflictMarkers`, parses it, and
   feeds it through `fromPersistedJSON`. This is the recommended entry point for
   loading model files from disk or git checkouts that may have unresolved
   conflicts.

3. Public export of `stripMergeConflictMarkers` from `mod.ts` so external tools
   (e.g. the GRQ `.fix-grq-unfixable-models.ts` script) can use it directly.

Closes #2103.

## Evidence

All 5176 existing tests pass. 8 new tests cover the merge conflict handling.

## Test Plan

- `test/fix/MergeConflictJSON.ts` (8 tests):
  - `stripMergeConflictMarkers: resolves git conflict markers keeping theirs side`
  - `stripMergeConflictMarkers: handles multiple conflict blocks`
  - `stripMergeConflictMarkers: returns unchanged text when no markers present`
  - `stripMergeConflictMarkers: handles real GRQ model conflict (issue #2103)`
  - `stripMergeConflictMarkers: handles conflict with differing values`
  - `fromPersistedText: loads creature from conflicted JSON text (issue #2103)`
  - `fromPersistedText: works with clean JSON too`
  - `stripMergeConflictMarkers: throws on unclosed conflict marker`
