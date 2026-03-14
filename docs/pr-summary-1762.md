## Summary

Cleanup of commented-out and dead code. Addresses #1762.

1. **Removed commented-out code in ABSOLUTE.ts** — Two lines of disabled alternative
   implementation (`nearZeroInput` check) were removed from `safeZoneAdjustment()`.
   The current behaviour (full confidence for near-zero inputs) is correct and now
   has explicit test coverage.

2. **Documented deprecated WASM enum values** — Investigated whether `Hypotenuse` (HYPOT),
   `HypotenuseV2` (HYPOTv2), and `Mean` enum values in `SquashType.ts` can be safely
   removed. They **cannot** because:
   - Serialised creatures may reference these squash types by name or numeric value
   - The upgrade path (`src/upgrade/UpgradeTwo.ts`) depends on them to convert old creatures
   - The WASM layer must handle pre-upgrade creatures that still use these types
   - All three have `mutationProbability = 0`, so they are never selected by new mutations

   Added comprehensive documentation explaining the backwards compatibility requirement.

## Evidence

- All 4905 tests pass
- New backwards compatibility tests verify deprecated types remain functional

## Test Plan

- Added `test/wasm/DeprecatedSquashTypeCompat.ts` — verifies deprecated squash types
  resolve correctly, have stable numeric values, are findable via `Activations`,
  have zero mutation probability, and can load creatures from JSON
- Added near-zero input test for ABSOLUTE safeZoneAdjustment in
  `test/methods/activations/SafeZoneAdjustment.ts`
