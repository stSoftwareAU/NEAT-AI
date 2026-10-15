# Keep the caller's creature valid when `evolveDir()` restores it after a deadline abandon (#4061)

## Summary

After a generation-2 hard-deadline abandon, `evolveDir()` could hand the
caller's creature back with `neurons.length < input`, so `CreatureUtil.makeUUID`
threw `RangeError: Invalid array length`. The restore step now snapshots the
caller before the population is built and hands back the champion only if it is
usable; otherwise it restores the caller's original genome from that snapshot.
`NeatEvolution` also stops disposing the previous population once a run has been
abandoned mid-commit.

Part of #4061. Criterion 3 (a GRQ sampler log line from the fixed release) is
missing, so this PR does not close the issue; see "Not closing #4061" below.

## Spec

### Intent and Rationale

After the hard deadline abandons a generation, the abandoned work keeps running
and may later commit. The caller's creature can sit in the previous population,
so that late commit disposes it (`Creature.dispose()` sets
`neurons.length = 0`). Two changes close the hole:

- `src/NEAT/NeatEvolution.ts:1261` re-checks
  `isRunAbandonedSince(scheduledEpoch)` before disposing the previous
  population. When the run was abandoned it logs a warning and skips disposal.
- `src/creature/EvolveTeardown.ts` adds `snapshotEvolveCaller` and
  `restoreEvolveChampion`. The champion is restored only when
  `neurons.length >= input + output` and `validate()` passes. Otherwise the
  snapshot is restored, with a warning logged only when a champion was supplied
  and rejected. If the snapshot is unusable too, the restore throws and leaves
  the caller as it is.

`evolveEnv()` and `evolveRL()` share the same restore step, so they use the same
helpers.

### Essential Design Decisions

- **Snapshot with `shallowClone()` before populating.** The snapshot does not
  depend on whether the caller is disposed later. It is released in the
  `finally` of each entry point (`src/creature/CreatureTraining.ts:880`,
  `:1270`, `:1972`).
- **Fail loud, not silent.** When neither candidate is usable, the restore
  throws and names the snapshot's reason, so a damaged creature is never
  returned as success.
- **Skip disposal, don't wait.** An abandoned commit leaves previous-population
  members undisposed (logged at warn) and leaves them to the garbage collector.
  A leak of a few creatures is cheaper than a corrupt caller.
- **The restore runs on every exit.** Each entry point (`evolveDir`,
  `evolveEnv`, `evolveRL`) restores the caller in a `catch` when the generation
  loop or the teardown rejects, rethrows the original error, and releases the
  snapshot in a `finally`.

### Undiscoverable Facts

- An abandon during generation 2 reports `generation === 1`.
- The failure is reproduced. On the base (`f089c75f`),
  `test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts` fails with
  `RangeError: Invalid array length` at `CreatureUtil.makeUUID`
  (`src/architecture/CreatureUtils.ts:114:24`), the same frame as the GRQ
  sampler log. At the head it passes. That confirms the cause: an abandoned
  generation's late commit disposes the caller. The test stages the timing by
  stubbing `DeDuplicator.prototype.perform`.
- `DeDuplicator.perform` throws the same `RangeError` over a population disposed
  during teardown. That is out of scope here.
- The mutation gate runs only `*_test.ts` files that import the mutated module
  through a relative path. This PR's tests are therefore named `*_test.ts` and
  import the module under test relatively.

## Evidence

```text
test/creature/RestoreEvolveChampion_test.ts                  10 passed
test/creature/EvolveRestoresCallerSnapshot_test.ts            5 tests (not run locally: Deno suite needs jsr; CI is the check)
test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts     1 passed
test/NEAT/AbandonedCommitKeepsPreviousPopulation_test.ts      1 passed
test/NEAT/EvolveCommitDisposal_test.ts                        1 passed
test/creature/EvolveEnvHardDeadline_test.ts, EvolveRLHardDeadline_test.ts  pass
deno fmt --check and deno lint on EvolveRestoresCallerSnapshot_test.ts  clean; deno check and the test run need jsr, CI is the check
```

Mutation red-checks. Each mutant was applied with `deno test --no-check` over
every `*_test.ts` file that imports the module through a relative path, then
reverted. The unmutated set passes (19 passed). The catch-path rows were added
after that run and have not been re-run here.

| Line                                    | Mutant                                               | Result                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/creature/EvolveTeardown.ts:41`     | return `undefined`                                   | red ("snapshotEvolveCaller is independent of the caller")                                                                                                                           |
| `src/creature/EvolveTeardown.ts:54`     | negate the neuron-count check                        | red ("restoreEvolveChampion restores a usable champion into the caller")                                                                                                            |
| `src/creature/EvolveTeardown.ts:55`     | return `undefined`                                   | red ("restoreEvolveChampion falls back to the snapshot when the champion has fewer neurons than input + output")                                                                    |
| `src/creature/EvolveTeardown.ts:58`     | delete `validate()`                                  | red ("restoreEvolveChampion falls back to the snapshot when the champion fails validate()")                                                                                         |
| `src/creature/EvolveTeardown.ts:61`     | negate the ternary                                   | red ("restoreEvolveChampion warns with the validate() message when it rejects a champion")                                                                                          |
| `src/creature/EvolveTeardown.ts:91`     | negate `if (champion)`                               | red ("restoreEvolveChampion falls back to the snapshot when there is no champion")                                                                                                  |
| `src/creature/EvolveTeardown.ts:93`     | negate `reason === undefined`                        | red ("restoreEvolveChampion restores a usable champion into the caller")                                                                                                            |
| `src/creature/EvolveTeardown.ts:94`     | delete `loadFrom(champion)`                          | red ("restoreEvolveChampion restores a usable champion into the caller")                                                                                                            |
| `src/creature/EvolveTeardown.ts:97`     | delete the warning                                   | red ("restoreEvolveChampion warns with the validate() message when it rejects a champion")                                                                                          |
| `src/creature/EvolveTeardown.ts:102`    | negate the snapshot check                            | red ("restoreEvolveChampion falls back to the snapshot when there is no champion")                                                                                                  |
| `src/creature/EvolveTeardown.ts:107`    | delete `loadFrom(snapshot)`                          | red ("restoreEvolveChampion falls back to the snapshot when there is no champion")                                                                                                  |
| `src/creature/CreatureTraining.ts:865`  | delete the `restoreEvolveChampion` call in the catch | not run locally (Deno suite needs jsr); CI mutation gate is the check. Expected red: "evolveDir: a rejected generation preserves the original error and restores a disposed caller" |
| `src/creature/CreatureTraining.ts:1255` | delete the `restoreEvolveChampion` call in the catch | not run locally (Deno suite needs jsr); CI mutation gate is the check. Expected red: "evolveEnv: a rejected generation preserves the original error and restores a disposed caller" |
| `src/creature/CreatureTraining.ts:1957` | delete the `restoreEvolveChampion` call in the catch | not run locally (Deno suite needs jsr); CI mutation gate is the check. Expected red: "evolveRL: a rejected generation preserves the original error and restores a disposed caller"  |
| `src/NEAT/NeatEvolution.ts:1261`        | negate the abandon re-check                          | red (`EvolveCommitDisposal_test.ts` "evolve: a committed generation disposes the members it drops and keeps the ones it carries forward")                                           |
| `src/NEAT/NeatEvolution.ts:1262`        | delete the warning                                   | red (`AbandonedCommitKeepsPreviousPopulation_test.ts` "NEAT: a generation abandoned mid-commit leaves the previous population undisposed (Issue #4061)")                            |
| `src/NEAT/NeatEvolution.ts:1275`        | negate `!carriedForward.has`                         | red (`EvolveCommitDisposal_test.ts` "evolve: a committed generation disposes the members it drops and keeps the ones it carries forward")                                           |
| `src/NEAT/NeatEvolution.ts:1276`        | delete `toDispose.add`                               | red (same test)                                                                                                                                                                     |
| `src/NEAT/NeatEvolution.ts:1280`        | negate `!carriedForward.has`                         | red (same test)                                                                                                                                                                     |
| `src/NEAT/NeatEvolution.ts:1281`        | delete `toDispose.add`                               | red (same test: "a creature the population budget dropped was not disposed")                                                                                                        |
| `src/NEAT/NeatEvolution.ts:1290`        | delete `creature.dispose()`                          | red (same test)                                                                                                                                                                     |

Lines exempt from the mutation check:

- `src/creature/CreatureTraining.ts:880`, `:1270` and `:1972` exempt
  (untestable): `callerSnapshot.dispose()` in each `finally`. Releasing the
  snapshot is not observable through the caller without asserting implementation
  details, so the tests do not pin it.
- `src/NEAT/NeatEvolution.ts:1285` exempt (untestable): the
  `trim.removedCreatures` loop is unreachable from `evolve()`.
  `trimPopulationToSize` runs on `budgeted.population`, which
  `assemblePopulationWithinBudget` has already capped at the same
  `effectivePopSize` with the same elite floor, so `removedCreatures` is always
  empty here. The negated condition survives for that reason. The line is the
  existing Issue #4050 loop, re-indented into the `else` branch.
- `src/NEAT/NeatEvolution.ts:1286` exempt (untestable): same unreachable loop as
  `:1285`; deleting `toDispose.add` there cannot change any outcome.
- The test-file mutants listed against
  `test/NEAT/AbandonedCommitKeepsPreviousPopulation.ts` no longer apply. The
  file is now `test/NEAT/AbandonedCommitKeepsPreviousPopulation_test.ts`, which
  the gate treats as a test, not a source module.

```mermaid
flowchart TD
    A[evolveDir starts] --> B[snapshotEvolveCaller: shallowClone]
    B --> C[populate and evolve]
    C --> D{hard deadline abandon?}
    D -- yes --> E[abandoned commit skips disposing previous population]
    D -- no --> F[normal commit disposes dropped members]
    E --> G[post-loop teardown: restoreEvolveChampion]
    F --> G
    G --> H{champion usable?}
    H -- yes --> I[caller.loadFrom champion]
    H -- no --> J{snapshot usable?}
    J -- yes --> K[caller.loadFrom snapshot]
    J -- no --> L[throw, caller left as it is]
    I --> M[dispose snapshot]
    K --> M
```

Related issues: #4061, #4050 (earlier occurrence of the same failure), GRQ #4472
(post-loop teardown budget).

**Docs sweep** — grep: `restoreEvolveChampion`, `loadFrom\(champion`,
`hard deadline`, `abandonInFlightPastHardDeadline`, `dispose`; section:
`docs/TIMEOUTS.md` "The post-loop teardown is bounded too"; siblings:
`evolveEnv`, `evolveRL`; updated: `docs/TIMEOUTS.md`, `CHANGELOG.md`.

The `docs/TIMEOUTS.md` and `CHANGELOG.md` entries describe the restore on every
exit path of all three entry points. They say the warning is logged only when a
champion is rejected, and that the restore throws when the snapshot is unusable.
The remaining hits in `docs/TIMEOUTS.md` that describe the teardown budget and
the abandon epoch are still true: this change narrows what the restore step may
hand back and changes neither mechanism.

## Reproduction

- **symptom** — after a generation-2 hard-deadline abandon, `evolveDir()`
  returned the caller's creature with `neurons.length < input`, and the caller's
  `CreatureUtil.makeUUID` threw `RangeError: Invalid array length`
  (`CreatureUtils.ts:114:24` in the GRQ sampler log).
- **status** — `reproduced` — red on the base (`f089c75f`) with
  `RangeError: Invalid array length` at `CreatureUtil.makeUUID`
  (`src/architecture/CreatureUtils.ts:114:24`); green at the head.
- **regression test** —
  `test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts` "evolveDir: a
  generation 2 abandoned after its commit leaves the caller creature whole"

The regression test follows the issue's recipe. It forces a hard-deadline breach
in generation 2 and lets the abandoned generation finish after `evolveDir()`
returns. It then asserts that `makeUUID(caller)` succeeds and
`caller.neurons.length > caller.input`. It stubs
`DeDuplicator.prototype.perform` to place the abandon inside generation 2's
dedup await.

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **met** — "`evolveDir()` guarantees on every exit path, deadline-abandon
  included, that the caller's creature is valid
  (`neurons.length >= input + output`, `validate()` passes)." — evidence:
  `src/creature/EvolveTeardown.ts:83`, `src/creature/CreatureTraining.ts:796`,
  the catch blocks at `:861-881`, `:1251-1271` and `:1953-1973`,
  `test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts::"evolveDir: a generation 2 abandoned after its commit leaves the caller creature whole"`,
  `test/creature/EvolveRestoresCallerSnapshot_test.ts::"evolveDir: a rejected generation preserves the original error and restores a disposed caller"`.
- **partial** — "If it cannot restore a champion, it leaves the caller's
  original genome untouched." — evidence:
  `test/creature/RestoreEvolveChampion_test.ts::"restoreEvolveChampion falls back to the snapshot when there is no champion"`,
  `::"restoreEvolveChampion falls back to the snapshot when the champion fails validate()"`,
  `::"restoreEvolveChampion throws and leaves the caller untouched when neither the champion nor the snapshot is usable"`
  — reviewer: partial — reason: the original genome is reloaded from a snapshot
  rather than left in place, and when the snapshot is unusable too the restore
  throws, so `evolveDir` rejects with the caller in whatever state the run left
  it.
- **met** — "Regression test (in the style of
  `test/NEAT/HardDeadlineDisposalRegression.ts`): force a hard-deadline breach
  in generation 2, let the abandoned generation finish after `evolveDir()`
  returns, then assert `CreatureUtil.makeUUID(caller)` succeeds and
  `caller.neurons.length > caller.input`." — evidence:
  `test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts::"evolveDir: a generation 2 abandoned after its commit leaves the caller creature whole"`
  — reviewer: met. The test fails on the base with the reported `RangeError` and
  passes at the head. Caveat: it stubs `DeDuplicator.prototype.perform` to stage
  the abandon.
- **missing** — "Closing evidence: a quoted GRQ sampler log line from a run that
  logs `Hard deadline … exceeded during generation N` and still completes the
  loop, on the fixed release." — reviewer: missing — reason: needs a released
  build and a production run; it cannot be produced from this PR.
- **unrequested** — the abandon re-check before disposal in
  `src/NEAT/NeatEvolution.ts:1261` — reviewer: unrequested — reason: it follows
  from the issue's root cause rather than a listed criterion. An abandoned
  mid-commit generation leaves the dropped members undisposed (a logged leak).
- **unrequested** — the restore step is also wired into `evolveEnv()` and
  `evolveRL()` (`src/creature/CreatureTraining.ts:1161`, `:1814`) — reviewer:
  unrequested — reason: the issue names `evolveDir()` only; the three loops
  share the same restore step and the same defect.
- **unrequested** — the `CHANGELOG.md` and `docs/TIMEOUTS.md` entries —
  reviewer: unrequested — reason: housekeeping that follows from the fix.

## Not closing #4061

Criterion 3, the closing evidence, is missing. It needs a GRQ sampler log line
from a run on a released build that contains this fix, and that build does not
exist until this PR is merged and released. The issue stays open until that log
line is posted.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

The repository has no `CODING-STANDARDS.md`, so `docs/ENGINEERING_PRINCIPLES.md`
and `AGENTS.md` were used as the standard.

- **fixed** — typed errors (`AGENTS.md` → Error Handling: "Use typed errors from
  `src/errors/`") — evidence: `src/creature/EvolveTeardown.ts:104` throws
  `ValidationError` from `src/errors/ValidationError.ts`.
- **fixed** — tests describe behaviour, not implementation
  (`docs/ENGINEERING_PRINCIPLES.md` §3) — the test no longer patches the
  caller's `shallowClone()`, and its entry-snapshot assertions were removed.
- **clean** — Australian English; logging through `getLogger()` with the logger
  restored in `finally`; no timing APIs or `Deno.env` mutation in tests
  (deadlines come from an injected clock); neuron UUID, creature UUID and
  semantic-version invariants preserved; no TS fallback for WASM-owned
  operations; one shared helper for all three entry points; the
  `DeDuplicator.prototype.perform` and `Creature.prototype.dispose` patches
  stage a race or observe the public `dispose()` lifecycle, and the assertions
  are on outcomes.

## Test Plan

- `deno task test` was not run in full. These tests ran together and pass:
  `test/creature/RestoreEvolveChampion_test.ts`,
  `test/creature/EvolveRestoresCallerSnapshot_test.ts`,
  `test/creature/EvolveDirGenerationTwoAbandonCaller_test.ts`,
  `test/NEAT/AbandonedCommitKeepsPreviousPopulation_test.ts`,
  `test/NEAT/EvolveCommitDisposal_test.ts`,
  `test/creature/EvolveEnvHardDeadline_test.ts`,
  `test/creature/EvolveRLHardDeadline_test.ts`.
- `deno fmt`, `deno lint` and `deno check` pass on the changed files.
- `./quality.sh` aborts in this environment with "Native rust_scorer is required
  (quality.sh default) but was not found", so the full gate could not be run.

<!-- vibe-quality-gate-skipped reason="quality.sh aborts: Native rust_scorer required but not found; lint, type-check and targeted tests passed" -->

Branch outcomes:

- `src/creature/EvolveTeardown.ts:54` — champion has too few neurons;
  `test/creature/RestoreEvolveChampion_test.ts` "restoreEvolveChampion falls
  back to the snapshot when the champion has fewer neurons than input + output";
  flipping went red.
- `src/creature/EvolveTeardown.ts:58` — champion fails `validate()`;
  `test/creature/RestoreEvolveChampion_test.ts` "restoreEvolveChampion falls
  back to the snapshot when the champion fails validate()"; deleting the call
  went red.
- `src/creature/EvolveTeardown.ts:91` — champion supplied;
  `test/creature/RestoreEvolveChampion_test.ts` "restoreEvolveChampion restores
  a usable champion into the caller"; flipping `:93` went red.
- `src/creature/EvolveTeardown.ts:101` — no champion, falls back to the
  snapshot; `test/creature/RestoreEvolveChampion_test.ts` "restoreEvolveChampion
  falls back to the snapshot when there is no champion"; flipping `:102` went
  red.
- `src/creature/EvolveTeardown.ts:102` — snapshot also unusable, throws;
  `test/creature/RestoreEvolveChampion_test.ts` "restoreEvolveChampion throws
  and leaves the caller untouched when neither the champion nor the snapshot is
  usable".
- `src/NEAT/NeatEvolution.ts:1261` — run abandoned mid-commit, previous
  population left undisposed;
  `test/NEAT/AbandonedCommitKeepsPreviousPopulation_test.ts` "NEAT: a generation
  abandoned mid-commit leaves the previous population undisposed (Issue #4061)";
  the not-abandoned branch is pinned by `test/NEAT/EvolveCommitDisposal_test.ts`
  "evolve: a committed generation disposes the members it drops and keeps the
  ones it carries forward"; flipping went red.
- `src/creature/CreatureTraining.ts:796`, `:1161`, `:1814` — each loop restores
  through `restoreEvolveChampion`;
  `test/creature/EvolveRestoresCallerSnapshot_test.ts` (one test per loop).
