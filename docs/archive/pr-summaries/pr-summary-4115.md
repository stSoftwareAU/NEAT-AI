## Summary

When the hard deadline abandons a generation after `processCompletedResults()`
has merged a discovery or replay creature, the Issue #4050 guard in `evolve()`
throws the creature away with no line naming it, after `discovery_complete` was
already emitted. The abandoned branch now logs
`Discovery <id> discarded: generation abandoned past the hard deadline` (or
`Replay <key> discarded: ...`) as a warning for each such creature. Closes
#4115.

Version bump: not touched here; CI records the final version on the merged
commit.

## Spec

### Intent and Rationale

- The result has already left `neat.discoveryComplete` and the replay queue, so
  the Issue #4099 teardown discard cannot name it. The abandoned branch of
  `evolve()` is the one place that still knows what is being dropped.
- The IDs come from what `processCompletedResults()` merged in this generation,
  as the issue asks, not from creature tags (which a creature can inherit).

### Essential Design Decisions

- `processCompletedResults()` takes a required `merged: MergedExternalResults`
  sink (`discoveryIDs`, `replayKeys`) instead of changing its return type, so
  its `Creature[]` contract and the training handling are untouched. The only
  production caller (`evolve()`) passes it; the one test caller was updated.
- An ID is recorded only where a creature is actually pushed into
  `trainedPopulation`; a discovery with no `improvedCreature` drops nothing and
  logs nothing. The replay key is `improvement.key ?? "replay"`, the same value
  already passed as `discoveryID` to the post-discovery validation.
- Training results (Issue #4107) are not handled here; that is a separate
  change, and this one does not depend on it.

### Undiscoverable Facts

- None.

## Evidence

Backend-only change; no UI files touched. Behaviour is pinned by
`test/NEAT/EvolveAbandonedDiscoveryReplayDiscard_test.ts`, which drives the real
`evolve()` and lands the abandon between result processing and the commit guard
(hook on the first `Mutator.prototype.mutate` call).

## Test Plan

- Added `test/NEAT/EvolveAbandonedDiscoveryReplayDiscard_test.ts` (3 tests):
  - abandoned generation: one `Discovery abandoned-discovery discarded: ...`
    warning and one `Replay abandoned-replay discarded: ...` warning, and the
    previous population's members are kept by reference.
  - negative control (no abandon, verbose): both creatures are merged and no
    `Discovery|Replay ... discarded:` line is logged.
  - a discovery result with no improved creature, abandoned: no discarded line.
- Red check: removing only the two new warn loops in `NeatEvolution.ts` turned
  the abandoned test red
  (`the discarded discovery must be logged exactly
  once, as a warning`); both
  other tests stayed green. The loops were restored and the tests re-run green.
- Edited `test/NEAT/NeatFinishUp.ts`: only the `processCompletedResults(...)`
  call gained the new required 4th argument; no assertion removed or changed.
- Entry point checked: `evolve()` is the only production caller of
  `processCompletedResults()`; it passes the sink and reads it in the abandoned
  branch (the new test reaches it through `evolve()`).
- Ran on the head: the new file, `test/NEAT/NeatFinishUp.ts` and
  `test/NEAT/AbandonedCommitKeepsPreviousPopulation_test.ts` — 29 passed, 0
  failed.
- Docs: `CHANGELOG.md` and `docs/TIMEOUTS.md` (teardown section) updated.

## Known limits

- Training results merged in an abandoned generation are covered by Issue #4107,
  not here.
- The mid-commit window after the Issue #4061 re-check is unchanged: the
  population is already committed there, so nothing is dropped.

<!-- vibe-quality-gate-skipped reason="full ./quality.sh not runnable here: it stops at 'Native rust_scorer is required'; deno fmt, deno lint, deno check and the covering tests were run on the touched files. CI runs the full gate." -->
