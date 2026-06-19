## Summary

Removed the unused export `getDistanceCacheMaxSize` from
`src/breed/DistanceCache.ts`. Static dead-code analysis (and a confirming
repo-wide `grep`) found the accessor had no in-repo importer, no test caller,
and was not re-exported from `mod.ts` — it was dead code.

The current maximum cache size remains observable through the surviving public
surface: `setDistanceCacheMaxSize()` sets it and `getDistanceCacheStats().maxSize`
reads it back, so no behaviour is lost. Closes #3063.

## Evidence

Backend/library change with no web interface — no screenshot applicable.

Verification performed:

- `grep -rn "getDistanceCacheMaxSize" --include="*.ts"` returned only the
  declaration before removal (no callers), confirming the function was dead.
- `deno test test/breed/DistanceCache.ts` passes (11 tests) after removal.
- Pre-existing flaky test `test/NEAT/RandomImmigrantsStagnationEscape.ts`
  (`createCompatibleFatherFromCreatures` in `src/breed/Father.ts`) intermittently
  fails in the full parallel `quality.sh` run. It passes in isolation **both
  with and without** this change, so it is unrelated to this dead-code removal.

## Test Plan

- Added `test/breed/DistanceCache.ts::"DistanceCache - max size is observable
  via stats"` — sets the max size via `setDistanceCacheMaxSize` and asserts it
  is reflected in `getDistanceCacheStats().maxSize`, including the clamp-to-1
  behaviour for values below 1. This locks in the replacement read path for the
  removed accessor.
- Existing `DistanceCache` and `CacheDiagnostics` tests continue to pass
  unchanged.
