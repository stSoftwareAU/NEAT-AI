## Summary

Third-pass audit of all test files in `test/config/`, `test/validate/`, and
`test/architecture/` (46 files, ~400+ test cases) addressing remaining quality
issues found after PRs #1817 and #1818. Closes #1771.

### Changes Made

**"How" tests rewritten as "what" tests (6 tests across 5 files):**

- `LoggerConfig.ts`: Replaced `typeof` checks on logger methods with
  behavioural test that calls each method; renamed immutability test from
  internal detail to behaviour-focused name with `TypeError`/`"Cannot assign"`
  assertion
- `NeatArguments.ts`: Replaced `typeof config.logger.info` and
  `typeof config.rng.random` checks with actual calls verifying the logger and
  rng are callable and produce valid results
- `WorkerThreadCapConfig.ts`: Renamed immutability test and added
  `TypeError`/`"Cannot assign"` assertion (consistent with LoggerConfig)
- `OutputRangeConfig.ts`: Same immutability test rename and assertion
  strengthening
- `CreatureState.ts`: Renamed "cacheAdjustedActivation is a DenseNumberMap"
  to "stores and retrieves values" — tests behaviour not type

**Implementation-detail tests rewritten as behavioural tests (4 tests):**

- `Score.ts`: Rewrote `updateScoreForWeightChange` "basic incremental update"
  to verify incremental result matches full recalculation (was only checking
  `Number.isFinite`)
- `Score.ts`: Rewrote "new weight exceeding max updates max" from checking
  internal `cachedScoreComponents.maxWeightBias` field to verifying large
  weight increase lowers score
- `Score.ts`: Same two rewrites for `updateScoreForBiasChange`
- `Score.ts`: Rewrote "computes cache if not present" to verify score matches
  full recalculation (was only checking cache existence)
- `Score.ts`: Strengthened "uses cached score components on second call" by
  adding cache-cleared recalculation verification

**Assertion anti-patterns fixed (1 file):**

- `NoChangePropagate.ts`: Replaced `assertEquals(bool, true)` with proper
  `assertGreaterOrEqual`/`assertLessOrEqual` assertions

**Weak assertions strengthened (2 files):**

- `NeatArguments.ts`: Replaced `assertNotEquals(x, undefined)` with positive
  assertions (`assert(x.length > 0)`, `assert(rng.random() >= 0)`)
- `CreatureUtils.ts`: Added UUID format validation to topology hash test;
  renamed "caches the hash" to "deterministic across repeated calls"

### Cross-area duplicates

- No new cross-area duplicates found

## Evidence

- All 4555 tests pass
- `./quality.sh` passes cleanly (lint, format, type-check, tests)
- 9 files changed across `test/config/`, `test/architecture/`

## Test Plan

- All 46 test files in `test/config/`, `test/validate/`, and
  `test/architecture/` re-reviewed
- Verified no regressions: full test suite (4555 tests) passes
- All remaining tests verify behaviour, not implementation details
