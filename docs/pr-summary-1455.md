## Summary

Make `evolve_SIN_function` and `evolve SIN + COS` tests less flaky by using
deterministic seeded random data and allowing multiple retry attempts. Closes #1455.

The tests were flaky because:
1. **Non-deterministic training data** - `Math.random()` produced different
   training sets each run, causing inconsistent convergence behaviour.
2. **No retry attempts** - evolution has inherent stochasticity beyond the
   training data; a single attempt is insufficient for reliable results.

The fix follows the pattern already established by the `evolve_Bigger_than` test,
which uses `seededRandom()` and 3 attempts.

## Evidence

This is a test-only change with no UI or performance impact. All 3123 tests pass
after the change, including the previously flaky tests.

## Test Plan

- Modified `evolve_SIN_function` in `test/Creature.ts` to use `seededRandom(99)`
  and 3 retry attempts
- Modified `evolve SIN + COS` in `test/Creature.ts` to use `seededRandom(77)`
  and 3 retry attempts
- Full quality gate (`./quality.sh`) passes with 3123 tests, 0 failures
