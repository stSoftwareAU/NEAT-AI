## Summary

Consolidate debug output directories by updating `debugWrite()` in
`CreatureValidate.ts` to use the shared `DIAGNOSTICS_DIR` constant from
`Diagnostics.ts` instead of the hardcoded `.test` directory. The `DEBUG` guard
was already inside `debugWrite()`, so no call-site changes were needed.

Closes #1726.

## Changes

- Exported `DIAGNOSTICS_DIR` from `src/utils/Diagnostics.ts` so it can be shared
  across modules
- Updated `debugWrite()` in `src/architecture/CreatureValidate.ts` to import and
  use `DIAGNOSTICS_DIR` instead of the legacy `".test"` directory
- Added test verifying diagnostic output goes to `.diagnostics/`

## Evidence

All 4588 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Added `test/validate/DebugWriteDiagnostics.ts` — triggers `debugWrite()` via a
  duplicate UUID validation error with `creature.DEBUG = true`, then verifies
  the diagnostic file is written to `.diagnostics/` (not `.test/`)
