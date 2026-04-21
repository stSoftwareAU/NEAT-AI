## Summary

Fix silent no-op in the `MOD_WEIGHT` mutation operator and clean up the
companion diagnostic messages. Closes #2383.

### Root cause

`ModWeight.performMutation()` selected one random non-frozen synapse,
computed a new weight via `calculateRegularisedWeight()`, and returned
`false` whenever the computed weight was equal to the current weight. This
happens legitimately in several situations:

1. **Boundary clamping.** When a synapse is already at `±maxAbsoluteWeight`
   (default `100`) and the random modification has the same sign as the
   current weight, step 6 of `calculateRegularisedWeight()` clamps the new
   weight back to the same boundary value — no observable change.
2. **Floating-point absorption.** When `|currentWeight|` is very large, a
   small modification (e.g. a weight-scaled delta of `1e-195` — the trigger
   called out in the dependency to #2378) is rounded away by IEEE-754
   addition: `currentWeight + modification === currentWeight`.
3. **Exact zero draw.** When the blended L2/base modification happens to be
   exactly zero (rare but possible given the random draw).

In all three cases the evolve loop received a `false` return and emitted
two noisy log lines:

```
MOD_WEIGHT didn't mutate the creature. ...
UUID didn't change after MOD_WEIGHT mutation, changed: false
```

The second message is structurally redundant whenever the first fires — a
mutation that did not change a weight cannot be expected to rotate the UUID.

### Fix

- **Retry budget in `ModWeight`.** `performMutation()` now draws a fresh
  `(synapse, modification)` pair up to `MOD_WEIGHT_MAX_RETRIES` (8) times.
  Each retry re-samples both the synapse index and the random modification,
  so a clamp in one direction is likely to succeed in the opposite direction
  on the next try. Any non-empty synapse set should almost always produce an
  observable change within the budget.
- **Demoted `didn't mutate` log** from `info` to `debug`, gated behind
  `creature.DEBUG`. An unfocused mutation returning `false` after an honest
  retry is best-effort behaviour, not a warning-worthy event.
- **Consolidated the UUID diagnostic** so it warns only when the operator
  reported `changed=true` but the UUID did not rotate — that is the actual
  bug signature (stateful mutation that forgot to invalidate the UUID
  cache). The previous `changed=false` noise is gone.

### Evidence

This is a backend/CLI change with no UI surface. Verification is via the
new unit tests plus the existing ModWeight behavioural suite.

Without the retry loop the new test
`ModWeight: retries past a no-op synapse to find a changeable one`
reliably hits ~6% no-op rate (188/200 successes). With the retry loop the
success rate is 200/200. Full ModWeight test suite (27 tests across
`ModWeightNoOpRetry`, `ModWeightBehavioural`, `ModWeightRegularisation`,
`ModWeightFocusFiltering`, `ModWeightFocus`) passes. The full `quality.sh`
run passes all 6006 tests.

### Test Plan

New file: `test/mutate/ModWeightNoOpRetry.ts`

- `ModWeight: returns false cleanly when maxWeightChange is zero (all
  attempts are no-ops)` — exhausts the retry budget against a config where
  no draw can succeed; asserts `changed === false` and that no weight was
  touched.
- `ModWeight: retries past a no-op synapse to find a changeable one` —
  builds a creature with one pinned-at-boundary synapse and six mutable
  synapses; asserts an effectively 100% success rate across 200 iterations
  (this test failed with the old single-shot logic).
- `ModWeight: returns false cleanly when creature has no mutable synapses` —
  regression test for the empty-synapse branch.
- `ModWeight: never reports changed=true without actually changing a
  weight` — stress test with a punishing boundary config; verifies the
  return-value contract across 500 iterations.
