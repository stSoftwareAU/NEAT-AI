## Summary

Fix for issue #1250: "WASM activation is required but not initialised" error
thrown from `combineImprovements()` during Intelligent Design squash improvement
scans.

The root cause was that `evaluateDir()` (called via `scoreDir()` from
`combineImprovements()`) did not auto-initialise WASM activation before calling
`requireWasmOrThrow()`. This was fixed in issue #1247 (commit afea9072) by
making `evaluateDir()` async and adding an `ensureWasmActivation()` call before
scoring.

This PR adds end-to-end integration tests that exercise the exact code path from
issue #1250 — `combineImprovements()` → `scoreDir()` → `evaluateDir()` →
`ensureWasmActivation()` — using real WASM scoring (not stubbed), to confirm the
fix works and prevent regression.

Version bumped from 0.295.13 to 0.295.14.

## Evidence

Unable to generate screenshot: This is a CLI library with no visual interface.

The fix is verified by integration tests that exercise the exact error path from
the issue report. Both tests call `combineImprovements()` with real dataset
directories and real WASM-based scoring, confirming that WASM is
auto-initialised without error.

## Test Plan

- Added `test/intelligentDesign/CombineImprovementsWasm.ts` with two tests:
  - `Issue #1250: combineImprovements auto-initialises WASM and scores without error`
    — exercises the combined improvement path with real WASM scoring
  - `Issue #1250: combineImprovements fallback path works with real WASM scoring`
    — exercises the marriage-failed fallback path with real WASM scoring
- All 1825 existing tests continue to pass (0 failures)
