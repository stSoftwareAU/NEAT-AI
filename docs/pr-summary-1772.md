## Summary

Final cleanup pass on the compact/optimisation test audit. Removes a trivial
assertion in `test/reconstruct/ConnectMissing.ts` and updates an outdated issue
reference comment in `test/Compact/IsAggregationSquash.ts`. Closes #1772.

## Audit Summary

Comprehensive audit of all test files across the five directories in scope
(test/Compact/, test/optimize/, test/optimization/, test/FeedForward/,
test/reconstruct/) confirmed:

- **No duplicate tests remain** across or within directories
- **All tests verify behaviour** (outcomes/side effects), not implementation
  details
- **All tests are meaningful** with real assertions on real code
- **Test names clearly describe** the behaviour being verified
- **No timing measurements** (performance.now, Date.now) in any test file
- **No source-file grepping** or implementation-detail inspection
- **test/optimize/ and test/optimization/ should remain separate** — they map to
  different source modules (src/optimize/ for activation simplification vs
  training strategies in src/propagate/ and src/config/)

### Changes in this PR

**test/reconstruct/ConnectMissing.ts** — Removed trivial `assert(uuid1)`
assertion. `CreatureUtil.makeUUID()` always returns a string, so asserting
truthiness adds no value. The subsequent `assertEquals(uuid1, uuid2)` already
provides meaningful verification.

**test/Compact/IsAggregationSquash.ts** — Updated outdated comment that
referenced issue #1392 as if the DRY unification was still pending. The shared
`isAggregationSquash` utility already exists in
`src/methods/activations/SquashUtils.ts`.

## Evidence

All 4520 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Verified `assert(uuid1)` removal does not weaken test coverage (assertEquals
  on line 48 already covers the value)
- Ran full quality gate: format, lint, type-check, and all 4520 tests pass
