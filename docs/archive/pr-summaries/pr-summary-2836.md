## Summary

Replaced a HOW-test (anti-pattern: assertion on an internal spy call count) in
`test/NEAT/FitnessDeduplication.ts` with assertions on the observable outcome.

The test `Fitness.calculate - different creatures are evaluated separately`
previously asserted only `mockWorker.evaluateCallCount === 2`. That pins the
test to the implementation detail that scoring happens via exactly two separate
`evaluate()` calls. A behaviour-preserving refactor — batching both creatures
into one worker round-trip, adding a cache layer, or coalescing calls — would
keep both creatures correctly scored yet flip the count and break the test for
the wrong reason. Because the count was the _only_ assertion, the test offered
no protection against an actual scoring regression.

The assertion now verifies the observable WHAT: both distinct creatures receive
a finite score, and because they differ structurally they receive **distinct**
scores. This survives behaviour-preserving refactors while still guarding the
real behaviour — that creatures with different UUIDs are scored independently
and not deduplicated.

Note: even though the mock worker returns a constant error (`0.1`), the two
creatures produce distinct scores because the score formula
(`1 - error - complexityPenalty - versionPenalty`, see
`src/architecture/Score.ts`) includes a structure-dependent complexity penalty —
creature 2's weight of `1.5 > 1` triggers a value penalty that creature 1 (all
weights/biases ≤ 1) does not incur.

Closes #2836.

## Evidence

Backend/test-only change — no web interface to screenshot. Verified via the test
suite.

Targeted run of the affected file:

```
running 4 tests from ./test/NEAT/FitnessDeduplication.ts
Fitness.calculate - deduplicates identical creatures by UUID ... ok
Fitness.calculate - different creatures are evaluated separately ... ok
Fitness.calculate - skips creatures that already have scores ... ok
Fitness.calculate - mixed population with duplicates and uniques ... ok

ok | 4 passed | 0 failed
```

## Test Plan

- Modified
  `test/NEAT/FitnessDeduplication.ts::Fitness.calculate - different creatures are evaluated separately`:
  removed the call-count-only assertion (`evaluateCallCount === 2`) and replaced
  it with outcome assertions — both creatures receive a finite score, and the
  two distinct creatures receive distinct scores.
- No production code changed; no other tests modified.
- `./quality.sh` run clean (fmt, lint, type-check, full test suite).
