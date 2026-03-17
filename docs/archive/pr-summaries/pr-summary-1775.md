## Summary

Audited all remaining categorical test files (~60 files) covering
infrastructure, error handling, and smaller functional areas. Removed
duplicates, fixed weak assertions, eliminated timing dependencies, and improved
test names. Closes #1775.

### Changes

**Duplicate tests removed (3 files):**

- `test/workers/WasmWorkerInitErrors.ts` — entirely redundant with
  `WasmWorkerInit.ts` (only instantiated error objects without testing real
  behaviour)
- `test/Upgrade/VersionHelpers.ts` — duplicate of `UpgradeVersionRouting.ts`
  (tested identical functions `getMajorVersion` and
  `upgradeSemanticVersionIfForwardOnlyConfirmed`)
- `test/Upgrade/VersionFourInvariant.ts` — duplicate of tests in
  `VersionThree.ts` and `UpgradeFourXRepair.ts`

**Weak assertions fixed:**

- `test/Upgrade/HYPOT.ts` — replaced `console.warn` with `fail()` for assertion
  failures; removed debug file I/O; removed unassertable activation comparison
  (upgrade is approximate for large networks)
- `test/Upgrade/HYPOTv2.ts` — same treatment for the large-network test; kept
  strict tolerance for small-network test; removed debug file I/O

**Timing dependency removed:**

- `test/multithreading/MockWorker.ts` — replaced `setTimeout(r, 200)` with
  event-based `sendAndReceive` helper to avoid flaky parallel test execution

**Test names improved:**

- `test/Upgrade/VersionThree.ts` — fixed misleading name "should be 3" to
  "should be 4" (test asserts version equals 4)
- `test/Upgrade/HYPOT.ts` — improved test name to describe behaviour
- `test/Upgrade/HYPOTv2.ts` — improved test names to describe behaviour

**Console output removed:**

- `test/Tag/TagNeuron.ts` — removed stray `console.log(json2)` debug output

**Assertion strengthened:**

- `test/presets/Presets.ts` — replaced `assertNotEquals(config, undefined)` with
  meaningful assertions on `populationSize`, `iterations`, and `targetError`

## Evidence

All 4487 tests pass. `quality.sh` passes cleanly (lint, format, type-check,
tests).

## Test Plan

- No new tests added — this is an audit/cleanup of existing tests
- Verified all remaining tests still pass after removing duplicates and fixing
  assertions
- Verified `quality.sh` passes with 0 failures
