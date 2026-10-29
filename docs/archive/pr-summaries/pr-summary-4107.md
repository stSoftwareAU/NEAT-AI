## Summary

When the hard deadline abandons a generation after `processCompletedResults()`
has already logged `Training <id> completed`, the Issue #4050 guard in
`evolve()` throws the generation's trained creatures away without a word. The
abandoned branch now logs a `Training <id> discarded` warning once per task
(`generation abandoned past the hard deadline`), so every `completed` line is
matched by what happened to its creature. Closes #4107.

Version bump: not touched here; CI records the final version on the merged
commit.

## Spec

### Intent and Rationale

- The result has already left `neat.trainingComplete`, so the Issue #4099
  teardown discard cannot name it. The abandoned branch of `evolve()` is the one
  place that still knows which trained creatures are being dropped.
- Chose the issue's first suggestion (log in the abandoned branch) over moving
  the `completed` line, because the `completed` line is the Issue #4099 terminal
  line for a merged task and its position is relied on elsewhere.

### Essential Design Decisions

- Tasks are named by the `trainID` tag, de-duplicated with a `Set`, because a
  task yields several variants (main, compact, backtracked, forward) that share
  one ID.
- Discovery and replay creatures carry no `trainID` and are not named; the issue
  only asks for training tasks.
- The window after the mid-commit re-check (Issue #4061) is unchanged: there the
  population has already been committed, so trained creatures are not dropped.

### Undiscoverable Facts

- None.

## Evidence

Backend-only change; no UI files touched. Behaviour is pinned by
`test/NEAT/EvolveAbandonedTrainingResultDiscard_test.ts`, which drives the real
`evolve()`.

## Test Plan

- Added `test/NEAT/EvolveAbandonedTrainingResultDiscard_test.ts`:
  - `evolve: a trained task discarded by a hard-deadline abandon is logged once as discarded (Issue #4107)`
    abandons the run between result processing and the commit guard (hook on
    `Mutator.prototype.mutate`), then asserts one `completed` line, exactly one
    `discarded` warning for a result with four variants, and that the previous
    population's members are kept.
  - `evolve: a trained task that is committed normally logs completed and no discarded line (Issue #4107)`
    is the negative control.
- Red check: removing only the new logging block turned the abandoned test red
  (`the discarded task must be logged exactly once, as a warning`); the negative
  control stayed green, as it should. The block was restored and the tests
  re-run green.
- Re-ran on the head: the new file plus
  `test/NEAT/AbandonedCommitKeepsPreviousPopulation_test.ts`,
  `test/NEAT/EvolveCommitDisposal_test.ts` and
  `test/NEAT/EvolveAbandonedAfterFitness.ts` — 8 passed, 0 failed.
- Docs: `CHANGELOG.md` and `docs/TIMEOUTS.md` (teardown section) updated.
- No existing test was edited.

<!-- vibe-quality-gate-skipped reason="full ./quality.sh not run in this run; deno fmt, deno lint, deno check and the covering tests were run on the touched files. CI runs the full gate." -->

## Known limits

- Not fixed here: `sortCreaturesByScore(neat.population)` in `evolve()` sorts
  the live array in place after fitness, so an abandon landing after fitness
  still sees a reordered population. The test therefore compares membership by
  reference. This predates the change and is outside issue #4107.
