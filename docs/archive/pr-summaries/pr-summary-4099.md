## Summary

Training completion is logged when its generation commits. A result merged into
an abandoned or failed generation receives one discard line. Trace-store errors
are reported separately, preserving the successful training result and its
completion line. Worker-boundary regressions now exercise actual scheduling,
late settlement, commit, teardown and persistence through `evolveDir`.

Qualifying production sampler evidence is still missing. Part of #4099.

## Spec

### Intent and Rationale

Preserve the queued-result finish-up fix delivered by merged PR #4104, complete
the commit-time terminal logging change, and resolve the pre-PR verifier's
trace-persistence defect and regression-test findings. The field criterion is
retained verbatim; available logs do not justify marking it met.

### Essential Design Decisions

- `processCompletedResults()` records task IDs and durations in
  `mergedTrainIDs`. `Neat.commitMergedTraining()` emits completion lines at the
  generation commit; abandonment and teardown emit discards and clear pending
  outcomes.
- A failure to persist a diagnostic training trace is logged independently of
  the successful worker response. It cannot enqueue a second failed-task result.
- Over-run and hard-deadline guards retain priority over another merge and
  population-scoring pass in `evolveDir`, `evolveEnv` and `evolveRL`.
- The worker regression resolves a controllable training response after the last
  requested generation returns and before `finishUp`. Scheduling, response
  handling, another generation commit and creature-store writes run normally.

### Undiscoverable Facts

- The original queued-result fix is included from v7.0.65 onward; this branch's
  additional commit-time logging and trace-persistence changes are unshipped.
- Independent Spec reviewer `/root/spec_reviewer` reviewed the diff and issue
  body: criteria 1–3 met, field evidence missing. Independent Standards reviewer
  `/root/field` reviewed the final diff against `AGENTS.md` and
  `docs/ENGINEERING_PRINCIPLES.md`: clean. Their verdicts are recorded below.
- The carry-over notice names only 40 of its 212 source locations. All 40 are
  covered below; the omitted 172 locations were not available in retained report
  artifacts and cannot be individually verified from that notice.

## Evidence

Backend-only change; no visual surface changed.

- The worker trace-write regression first failed on this run's starting head:
  one successful response produced both `Training failed for creature <id>` and
  `Training <id> completed`. It passes after isolating trace persistence errors.
- The identical late-worker-promise regression fails against `v7.0.62`, commit
  `45e62c81d429601a9b35f747ea54f9d1775c2ed1`: actual completion count 0,
  expected 1. It passes at head and verifies the trained creature in both the
  population and creature store. The Spec reviewer checked the red log and tag.
- The public parked-breeding abandonment regression fails against base commit
  `e275a8278147d2f2abaa59eb8a057ec0e857959f` because it receives a completion
  line before discard. It passes at head, preserving the committed population
  and a non-empty creature store, including after the breeding promise resumes.

### Field evidence checked on 2026-11-13

A read-only audit downloaded 76 historical log files, including 49 containing a
NEAT-AI version. All ten observed settled-result finish windows across nine
snapshots led to over-run termination and explicit discard, without a qualifying
late completion. The original fix has shipped; its requested production outcome
has not been demonstrated by these snapshots.

| Log and immutable revision                                                                           | Release | Observed outcome                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GRQ-3-sloth.log` at `c2c49587c8850738d1b293940fb344bf622eca21` (2026-11-09T05:21:55Z)               | 7.1.12  | Lines 825–827: settled wait, over-run stop, discard of `5c1db96e`; parsed as rejected, without completion.                                                  |
| `GRQ-3-sloth.log` at `fda98f174a6ed9261bee357c8bbbecd1ccf718d1` (2026-11-10T22:30:58Z)               | 7.1.15  | Lines 534–537: two settled results, over-run stop, discards of `89130576` and `20c163b1`; lines 666–667 still parse both as `in_flight … reason=log-ended`. |
| Latest green sampler diagnostic at `dba84d71392611bd6c1123f96496b1783b129b47` (2026-11-12T10:38:42Z) | —       | Ten-line capability excerpt; no training evidence.                                                                                                          |
| Audited log-repository head `3e51bf407a4622bef832559d0a9608edefb92d16` (2026-11-13T03:28:14Z)        | —       | Only scorer and portfolio logs; no sampler run.                                                                                                             |

The 7.1.15 completion lines for `ef0834b8` and `804474fb` belong to tasks
scheduled before generation 1, so they do not satisfy the last-generation field
criterion. The GitHub plugin returned 404 for the private log source; immutable
snapshots were read with `gh api`.

## Reproduction

- **symptom** — successful training could be reported failed when trace
  persistence threw, then also completed; merged results could be reported both
  completed and discarded when their generation was abandoned.
- **status** — `verified`: the trace regression failed before its fix; the
  public abandonment regression failed against the base; the late-worker
  regression failed against v7.0.62. All pass at head.
- **regression tests** — `test/creature/EvolveDirLateTrainingResult.ts` and
  `test/NEAT/EvolveAbandonedTrainingResultDiscard_test.ts`.

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **met** — Before `finishUp` can return `true`, it also checks
  `trainingComplete.length > 0` (and `discoveryComplete`). When either is
  non-empty it arms one more processing pass. Alternatively, the teardown drains
  `trainingComplete` into the population and re-scores before
  `restoreEvolveChampion`/`writeCreatures`. Whichever route: a settled result is
  either merged or explicitly logged as discarded with its id. — evidence:
  `test/NEAT/NeatFinishUp.ts` queued-training, queued-discovery and over-run
  cases; `test/creature/BoundedEvolveTeardown.ts` persistence/failure cases;
  `test/creature/EvolveDirLateTrainingResult.ts` worker settlement and persisted
  population — reviewer: met
- **met** — Every scheduled training task ends with exactly one terminal line
  (`completed`, `failed`, `abandoned`, or a new `discarded at teardown`). —
  evidence:
  `test/creature/EvolveDirLateTrainingResult.ts::evolveDir: trace persistence failure preserves one completed training outcome (Issue #4099)`;
  `test/NEAT/EvolveAbandonedTrainingResultDiscard_test.ts::evolveDir teardown: a worker result merged before breeding wedges is discarded once and preserves the committed population (Issue #4107)`;
  `test/creature/EvolveFailureNamesInFlightTasks_test.ts` — reviewer: met
- **met** — Regression test: stub a worker whose training promise resolves
  **after** the final generation's `processCompletedResults` but before
  `finishUp`. Then assert that (a) the trained creature reaches the returned
  population or the creature store, or a `discarded` line names the task, and
  (b) `Training <id> completed` is logged. On `v7.0.62` this test fails. —
  evidence:
  `test/creature/EvolveDirLateTrainingResult.ts::evolveDir: a worker training promise settled after the last generation is merged and persisted (Issue #4099)`;
  identical test red-checked against tag commit
  `45e62c81d429601a9b35f747ea54f9d1775c2ed1` — reviewer: met
- **missing** — Field evidence: a GRQ sampler log on a neat-ai release carrying
  the fix where a task scheduled in the last generation shows
  `Training <id> completed`, with no `outcome=in_flight … reason=log-ended` in
  `[training-outcomes]`. — reviewer: missing — reason: no audited snapshot
  demonstrates the requested last-generation completion; the observed late
  results were discarded at the over-run bound.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **clean** — Independent reviewer checked `AGENTS.md` and
  `docs/ENGINEERING_PRINCIPLES.md` (this repository has no
  `CODING-STANDARDS.md`). Worker regressions assert terminal logs, population
  and persisted creatures; the prohibited merged-map assertions and manual
  commit simulation are removed. Coverage tests assert behaviour and restore
  seeded random state. Logging uses `getLogger()`; Australian English; no
  identity, semantic-version, dependency or wire-format changes; no timing APIs
  or environment mutation added to tests.
- **clean** — Reviewer validation: 12 focused tests passed; lint and format
  checks passed all 14 changed/new TypeScript files. Two existing-test import
  substitutions resolve to the same modules and retain all assertions.

## Coverage carry-over

Four deterministic behaviour tests restore the named cold-start quota,
activation-mismatch, fine-tuning and maternal-memetic paths. Existing routing
and repair tests cover the remaining named lines. Their alias imports now use
relative paths so the carry-over import scanner discovers those tests too.

| Source locations named in the notice                     | Behaviour tests reaching them at head                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/NEAT/BreedingQuotas.ts:132–141,151`                 | `test/breed/BreedingQuotasColdStart_test.ts`                                                             |
| `src/architecture/BehaviourGuard.ts:435,436,440–443,446` | `test/compact/IfRoutingScoreInvariant.ts`                                                                |
| `src/architecture/Offspring.ts:625,626,674,675`          | `test/breed/OffspringMemeticInheritance_test.ts`                                                         |
| `src/architecture/RepairInvalidIfNeurons.ts:66,68–76`    | `test/architecture/CreatureFactorySeedIfRoles.ts`, `test/architecture/StaleUuidAfterStructuralChange.ts` |
| `src/blackbox/Discover.ts:37,38`                         | `test/blackbox/DiscoverSquashMismatch_test.ts`                                                           |
| `src/blackbox/FineTune.ts:478–482,484`                   | `test/blackbox/FineTuneChangedSquash_test.ts`                                                            |

The seven-file coverage run passed 36 tests. Its LCOV report records non-zero
hits for every one of these 40 locations. No production lines were deleted and
no untestable exemptions are claimed. The omitted 172 locations remain
unaudited; this table does not claim to close the entire 212-line report.

## Test Plan

- `deno test -A` over the 11 focused issue/regression/invariant files, with
  stdin from `/dev/null`: 91 passed, 0 failed. Includes abandonment, finish-up,
  merged results, discovery/replay, bounded teardown, failure cleanup, late
  worker settlement, neuron UUID stability and semantic-version stability.
- The seven-file carry-over coverage command, with stdin from `/dev/null`: 36
  passed, 0 failed. Includes the four new tests and the three existing routing,
  repair and structural-identity test files named above.
- Independent Spec review: 52 adjacent tests and eight final abandonment/late
  worker tests passed. Independent Standards review: 12 focused tests passed.
- Removed the direct merge/commit simulation in `test/NEAT/NeatFinishUp.ts`; its
  completion and trained-population assertions are now proved through the actual
  public worker/commit/persistence regression. The pending-breeding abandonment
  case likewise uses the public evolution and worker boundaries.
- `DENO_JOBS=1 ./quality.sh < /dev/null` could not start the full gate in this
  resumed environment: native `rust_scorer` is absent. It failed the explicit
  preflight; no fallback or full-suite success is claimed for this revision.
- `./quality.sh --skip-tests < /dev/null` exited 0: dependencies unchanged,
  formatting, lint, shell checks, all type checks and pinned WASM verification
  passed. Discovery verification skipped because its library was absent.
- `deno test -A test/docs/ArchiveDocsNoPrivateRepoSlugs.ts < /dev/null` passed
  (one test); `deno fmt` formatted this summary.

## Merge verification

CI and review remain pending. Production sampler evidence and the omitted 172
carry-over locations remain unverified. The worker will rerun the quality gate
and verifier before raising the pull request. Optional native discovery, GPU and
native-training lanes were not run here.
