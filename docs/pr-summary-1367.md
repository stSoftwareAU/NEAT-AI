## Summary

Simplified the redundant `feedbackLoop` condition in `CreatureValidate.ts`.

The original code used `feedbackLoop !== undefined && feedbackLoop === false`
which is equivalent to just `feedbackLoop === false`. The `!== undefined` guard
is redundant because if `feedbackLoop` is `undefined`, the `=== false` check
already evaluates to `false`.

The code simplification was applied in #1363. This PR adds dedicated tests to
verify the behaviour of all `feedbackLoop` states (false, true, undefined,
omitted, no options).

## Evidence

This is a backend logic change with no UI impact. The fix was verified by
running the full test suite (2216 tests passed).

## Test Plan

- Added `test/validate/FeedbackLoopCondition.ts` with 5 tests:
  - `feedbackLoop: false rejects recursive synapses` — verifies
    RECURSIVE_SYNAPSE error
  - `feedbackLoop: undefined allows recursive synapses` — verifies no error
    thrown
  - `feedbackLoop: true allows recursive synapses` — verifies no error thrown
  - `feedbackLoop: omitted allows recursive synapses` — verifies empty options
    work
  - `feedbackLoop: no options allows recursive synapses` — verifies no-options
    call works
