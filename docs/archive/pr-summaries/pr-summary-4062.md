# Record checkpoint log evidence; keep the producer investigation open

## Summary

Part of #4062.

PR #4100 records downstream log evidence following the checkpoint export prune
already merged in PR #4064. It does not add that production fix or establish
which mutation created the stale memetic. The review correction removes claims
that a synthetic write hook identifies the producer, and clarifies the test
comments to match their scope.

Version bump: `deno.json` updated for this change; the merged commit records the
final version.

## Evidence

- The current issue description requires either the host checkpoint or a
  reproduction during a deadline-abandoned generation, plus core validation of
  every file written through the identified path.
- The owner's 22–23 October direction predates this branch's first commit
  (2026-10-28T04:31:35Z) and still requires those criteria to be completed. The
  log evidence alone does not fulfil them.
- `gh pr view 4064 --json title,mergedAt,mergeCommit` confirms the checkpoint
  fix merged on 2026-10-14T22:35:02Z as
  `d7c8f72233098650148e1fe6bfd60a12aff59f35`.
- `git diff origin/Develop...HEAD` before this review correction contained only
  the summary and `deno.json`. The writer prune and its tests already exist on
  this PR's base.
- The previously recorded red check used `CheckpointWriter.ts` from `f089c75f`,
  before PR #4064. It is historical evidence for that fix, not a red run against
  PR #4100's base. Old gate totals and mutation results have been removed from
  this PR's Test Plan.

## Closing evidence

Evidence recorded by the earlier PR #4100 run (not re-fetched in this review
fix). Source: the downstream production log repository's `Develop` branch (the
repository named in the issue), cloned with
`git clone --single-branch --branch Develop --shallow-since=2026-10-10` (1155
commits, 2026-10-10 to 2026-10-28). The fix first appears in a deployed build as
`[neat-ai] running version 7.0.57`, first logged in commit `c79ed9e`
(2026-10-15T15:25+11:00); the report was on 7.0.55 (first logged in `55bc4e8`,
2026-10-12). Every snapshot at the Develop head reads `running version 7.0.62`
(417 lines, 2026-10-25 to 2026-10-28).

- Search 1, the whole history of every log file:
  `git log -S"rule=ValidationError/MEMETIC" --name-only`. Result: two commits
  only, both `GRQ-21-rocket.log` — `8f7f82c` (2026-10-13, the line the issue
  quotes; the positive control,
  `git show 8f7f82c:GRQ-21-rocket.log | grep -c
  "ValidationError/MEMETIC"`
  is 1) and `6f8c1a3` (2026-10-14T21:17Z, the rotation that removed it).
- Search 2, broader, from the day the fix merged:
  `git log -G"creature-repair\] INVALID|repairing an INVALID creature"
  --since=2026-10-14T22:35:00Z`.
  Result: no commits.
- Search 3, the current snapshot of all 25 log files:
  `grep -c "ValidationError/MEMETIC" *.log` and
  `grep -c creature-repair
  *.log`. Result: 0 in every file.
- Window on the fixed release: 2026-10-15T04:25Z (7.0.57 first logged) to
  2026-10-28T04:24Z, about 13 days, across 1072 log commits. No
  `rule=ValidationError/MEMETIC` repair line and no `INVALID CREATURE` repair
  line of any rule appears in it.

Limits: the logs are periodic snapshots that rotate, so a repair line written
and rotated out between two snapshots would not be seen; the loads that would
log one do appear (`copyNetworks` lines appear in the current snapshots, for
example `GRQ-13-rocket.log`, `GRQ-18-rocket.log`, `GRQ-21-rocket.log`). This is
an absence of the line in the sampled logs on the fixed release; events between
snapshots remain unverified.

## Reproduction

- **symptom** — the issue quotes a missing-synapse memetic error from a numbered
  host checkpoint on neat-ai 7.0.55.
- **status** — `partial`: no original host checkpoint was loaded in this PR, and
  no production mutation was identified. Log rotation does not establish whether
  `.creatures/10.json` still exists on the host.
- **synthetic coverage** —
  `test/creature/CheckpointWriteDanglingMemetic_test.ts` directly filters a live
  creature's synapses from a `writeTextFile` hook between exports. Its two-file
  test checks memetic references with test helpers. Its separate core-validation
  test creates the stale memetic before writing one file. Neither test runs a
  deadline-abandoned generation through checkpoint writing and validates every
  resulting file with `creatureValidate`.
- `src/NEAT/NeatEvolution.ts::evolve` checks the abandon epoch after fitness and
  before committing the population. Merely starting and abandoning it does not
  demonstrate that a production mutation leaves a stale memetic.

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

The two incomplete criteria have partial supporting evidence, but are marked
`missing` here so this PR cannot close the issue.

- **missing** — The original host checkpoint and a production reproduction
  remain unverified. The synthetic synapse filter exercises the write boundary
  without establishing how the stale memetic arose.
- **met** — `writeCreatures` never persists a memetic reference to a missing
  synapse through the tested array-of-rows export path — evidence:
  `src/creature/CheckpointWriter.ts::writeCreatures` calls
  `src/compact/MemeticCleanup.ts::pruneDanglingMemeticFromExport` before
  writing. This protection was merged in PR #4064; it changes the export,
  leaving the live creature's stale memetic untouched.
- **missing** — Core validation of every checkpoint file from a production
  reproduction remains unverified. Coverage consists of a synthetic multi-file
  test and a separate single-file core-validation test.
- **met** — Closing evidence: a week of downstream sampler logs without
  `rule=ValidationError/MEMETIC` repair lines on the fixed release, quoted with
  the search used — evidence: Closing evidence above, subject to its snapshot
  and rotation limits. This does not identify the producer.

## Test Plan

Only explanatory comments changed in
`test/creature/CheckpointWriteDanglingMemetic_test.ts`; test behaviour and
production code are unchanged. No new regression test or red-on-base result is
claimed by this review correction.

Checks run for this review correction:

- `deno test -A test/creature/CheckpointWriteDanglingMemetic_test.ts`: 10 tests
  at head, 10 passed, 0 failed; type checking also passed.
- `deno fmt --check` on the changed summary and test file: passed.
- `deno lint test/creature/CheckpointWriteDanglingMemetic_test.ts`: passed.
- `markdownlint-cli2 docs/archive/pr-summaries/pr-summary-4062.md`: passed.
- `git diff --check`: passed.
- `timeout 900 ./quality.sh < /dev/null`: failed at preflight with "Native
  rust_scorer is required (quality.sh default) but was not found." The full
  suite did not run. No product change is made for this environment
  prerequisite.

Copies checked: the summary's Summary, Evidence, Reproduction, Acceptance
Criteria and Test Plan; the test module, fault helper and write-hook comments;
`docs/PERFORMANCE_TUNING.md`'s checkpoint paragraph. The manual describes the
export protection, which remains true; the three test comments asserting or
implying a production abandoned-generation reproduction were corrected. No
production branches, call sites, dependencies or persisted formats changed.

Skipped or unverified: the original host checkpoint, a real producing mutation,
and an abandoned-generation reproduction with core validation of every written
file. The downstream log searches above were retained from the earlier run.
