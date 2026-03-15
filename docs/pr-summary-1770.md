## Summary

Complete audit of all test files in `test/wasm/`, `test/methods/`, and
`test/squash/` for quality standards. Closes #1770.

This PR builds on the 4 prior audit PRs (#1812-#1815) by addressing remaining
issues across 21 files:

- **Removed 14 duplicate/near-duplicate tests** across both WASM and activation
  test suites
- **Deleted `ActivationOptimisation.ts`** entirely (all 8 tests were duplicates
  of EdgeCases.ts, SquashDerivative.ts, and SquashRoundtrip.ts)
- **Converted 5 "how" tests to "what" tests** or removed them (module export
  inspection, internal field checks, alias resolution)
- **Strengthened 12 weak/tautological assertions** (replaced `assert(a === b)`
  with `assertEquals`, removed redundant `assertIsError` after `assertThrows`,
  pinned expected values instead of trivial bounds)
- **Removed 2 meaningless no-assertion init tests** and replaced with top-level
  `await`
- **Refactored FusedCostScoring.ts** with a helper function, eliminating ~200
  lines of boilerplate duplication
- **Split 1 compound test** into 6 individual named tests (WasmActivationErrors
  batch cost methods)
- **Fixed 2 misleading test names** (WasmPersistentTrainingState,
  WasmCompilationCache)

Net result: -530 lines across 21 files while maintaining full test coverage
(4588 tests pass).

### Cross-area duplicates identified and removed

- `ActivationOptimisation.ts` duplicated `EdgeCases.ts`, `SquashDerivative.ts`,
  `SquashRoundtrip.ts`
- `WasmFacadeRefactoring.ts` "throws after free" duplicated
  `WasmActivationErrors.ts`
- `WasmCreatureActivationLRU.ts` disposeWasm idempotency duplicated
  `WasmMemoryLifecycle.ts`
- `SafeZoneAdjustment.ts` loop tests duplicated `SharedSafeZoneAdjustment.ts`
- WASM init tests duplicated across 5 files

### Prior passes (PRs #1812-#1815)

- Removed meaningless getName() tests, duplicate squash/unSquash tests
- Converted 60+ silent test skips to assertions
- Strengthened 40+ weak assertions with specific expected values
- Replaced "how" tests with behaviour-based equivalents
- Cleaned up redundant assertion patterns

### Directories reviewed

- `test/wasm/` (27 files) — all reviewed
- `test/methods/` (15 files) — all reviewed
- `test/squash/` (2 files) — all reviewed

## Evidence

All 4588 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- No new tests added; existing tests strengthened and deduplicated
- Verified all assertions are meaningful with specific expected values
- All `test/wasm/`, `test/methods/`, and `test/squash/` files reviewed
- `./quality.sh --skip-discovery` passes with 0 failures
