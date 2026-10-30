## Summary

When the hard deadline abandons a generation after `processCompletedResults()`
has already logged `Training <id> completed`, the Issue #4050 guard in
`evolve()` throws the generation's trained creatures away without a word. Each
such task is now logged once as a `Training <id> discarded` warning
(`generation abandoned past the hard deadline`), by the abandoned `evolve()` or,
when it never resumes, by the teardown, so every `completed` line is matched by
what happened to its creature. Closes #4107.

Version bump: not touched here; CI records the final version on the merged
commit.

## Spec

### Intent and Rationale

- The result has already left `neat.trainingComplete`, so the Issue #4099
  teardown scan of that queue cannot name it. The merged IDs are therefore kept
  on the `Neat` instance until the generation commits.
- The abandoned branch of `evolve()` alone is not enough (PR #4114 review): in
  `evolveDir` the abandoned `evolve()` can wait forever at
  `await breedingPromise`, because the teardown terminates the workers its breed
  requests are queued on and `WorkerHandlerBase.terminate()` drops them
  unsettled (GRQ #4489). The teardown's step 2b (`discardUnprocessedResults()`)
  names whatever is still pending.
- Chose the issue's first suggestion (log in the abandoned branch) over moving
  the `completed` line, because the `completed` line is the Issue #4099 terminal
  line for a merged task and its position is relied on elsewhere.

### Essential Design Decisions

- Tasks are named from the training results `processCompletedResults()` merged
  in this generation: it adds each merged result's ID to
  `neat.mergedUncommittedTrainIDs`, so a task with several variants (main,
  compact, backtracked, forward) is named once. The commit clears the set.
- `Neat.discardMergedUncommittedTraining()` logs and clears the set. Both the
  abandoned branch of `evolve()` and `discardUnprocessedResults()` call it, so
  whichever runs first names each task and the other finds nothing: exactly one
  line per task. At teardown the reason is
  `generation abandoned past the hard deadline` when the run was abandoned past
  the hard deadline (or its first-generation bound), and
  `its generation ended before it committed` otherwise (a generation that threw
  after merging).
- Fixing the worker termination itself (settling dropped requests so the
  abandoned `evolve()` resumes) is a larger change to run control flow and is
  not attempted here.
- Creature `trainID` tags are not used (PR #4114 review): a discovery or replay
  creature built from a trained fittest inherits that earlier, already committed
  task's tag, and would otherwise be named as discarded. The base branch
  separately names discovery and replay results by their own IDs or keys
  (#4115); this PR adds training-task tracking alongside that reporting.
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
  - `evolve: a discovered creature is discarded by its discovery ID without naming an earlier training task (Issue #4107)`
    merges a discovery result whose creature carries an earlier task's `trainID`
    into the abandoned generation and asserts that its discovery ID and the
    current training task are named, without naming the earlier training task.
  - `evolveDir teardown: a trained task merged into a generation whose breeding never settles is logged once as discarded (Issue #4107)`
    parks `evolve()` at `await breedingPromise` (breeding settles only when the
    test releases it), fires the hard-deadline abandon, runs
    `runBoundedEvolveTeardown`, and asserts exactly one `discarded` line while
    `evolve()` is still parked. It then releases breeding and asserts the
    resumed `evolve()` takes its abandoned branch without naming the task again.
  - The first test also runs `discardUnprocessedResults()` after the abandoned
    `evolve()` and asserts the task is still named once.
- Red check: removing only the new logging block turned the abandoned test red
  (`the discarded task must be logged exactly once, as a warning`); the negative
  control stayed green, as it should. The block was restored and the tests
  re-run green. Review round: with the earlier tag scan restored in `evolve()`,
  the discovered-creature test failed
  (`a task committed in an earlier generation must not be logged as discarded`);
  with the fix, all three tests pass. Second review round: against the previous
  head's source the new teardown test failed
  (`the teardown must name the merged task while evolve() is still parked`);
  with the fix it passes.
- Re-ran on the head: the new file plus
  `test/NEAT/AbandonedCommitKeepsPreviousPopulation_test.ts`,
  `test/NEAT/EvolveCommitDisposal_test.ts`,
  `test/NEAT/EvolveAbandonedAfterFitness.ts`, `test/NEAT/NeatFinishUp.ts`,
  `test/creature/BoundedEvolveTeardown.ts`,
  `test/creature/EvolveDirBoundedTeardown.ts`,
  `test/creature/EvolveDirLateTrainingResult.ts` and
  `test/creature/EvolveTeardown.ts` — 58 passed, 0 failed. Also the other
  hard-deadline and teardown tests (`FitnessStallWatchdog.test.ts`,
  `HardDeadlineDisposalRegression.ts`, `HardDeadlineFirstGeneration.ts`,
  `NeatAbandonLateCompletion.ts`, `NeatHardDeadlineEnforcement.ts`,
  `EvolveDirGenerationTwoAbandonCaller_test.ts`, `EvolveDirHardDeadline.ts`,
  `EvolveFailureNamesInFlightTasks_test.ts`) — 24 passed, 0 failed.
- Docs: `CHANGELOG.md` and `docs/TIMEOUTS.md` (teardown section) updated.
- Merge validation: combined training and discovery/replay discard reporting;
  updated the inherited-tag test to expect the discovery warning alongside the
  current training task warning. The stale training ID remains forbidden.
  Targeted merge checks: the training discard, discovery/replay discard and
  merged-result suites passed (10 tests); formatting passed. Full quality gate
  deferred to CI for this merge.

<!-- vibe-quality-gate-skipped reason="full ./quality.sh not run in this run; deno fmt, deno lint, deno check and the covering tests were run on the touched files. CI runs the full gate." -->

## Known limits

- Not fixed here: `sortCreaturesByScore(neat.population)` in `evolve()` sorts
  the live array in place after fitness, so an abandon landing after fitness
  still sees a reordered population. The test therefore compares membership by
  reference. This predates the change and is outside issue #4107.
