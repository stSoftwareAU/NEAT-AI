## Summary

Runner crashes now fail the required coverage shard after writing its error
status. The `always()` upload still publishes shard artifacts, while ordinary
test failures remain aggregated after every shard has run. Closes #4117.

The regression suite also runs against deliberately broken workflow fixtures to
verify that its checks reject wrong exits, status markers and artifacts.
Troubleshooting guidance separates the initial OOM retry triggers from the final
exit codes that fail a shard after that retry is exhausted.

Version bump: `deno.json` updated for this change; the merged commit records the
final version.

## Spec

### Intent and Rationale

- A crashed runner must make its required shard check red, because the merge job
  is not a required ruleset check.

### Essential Design Decisions

- Keep exit 1 as the ordinary test-failure signal; fail only on a final runner
  exit other than 0 or 1, after any OOM retry.
- Keep `fail-fast: false`, aggregation after shard failures, and the existing
  `always()` artifact upload.

## Evidence

`test/ci/CoverageFailsPrOnTestFailure.ts` executes the parsed workflow shard
shell block with controlled runner exit codes. Before the workflow fix, the
crash cases recorded `error:139` / `error:137` but returned exit 0. With the
guard removed again, both regression tests went red at the expected nonzero exit
assertion.

`test/ci/CoverageRegressionSensitivity.ts` imports those positive controls and
adds 36 sensitivity cases. Child Deno processes run the original suite against
workflow fixtures with incorrect exits, status markers, incomplete/empty JUnit,
non-directory coverage paths, conditional/missing uploads and broken aggregation
settings. The cases require assertion failures or the specific missing-step /
missing-status diagnostic, and verify that the shard harness removes its
temporary workspace. A positive child run also checks isolation from inherited
runner state. The harness now supplies a clean shell environment so CI-level
variables cannot mask a missing fixture variable.

The harness replaces `$(nproc)` with a fixed four-core value, alongside its
`/proc/meminfo` fixture, so the shard shell does not need GNU coreutils CPU
discovery on macOS. A regression shadows `nproc` with a function returning 127
and runs the original suite, covering passing tests, ordinary failures, crashes
and both OOM retry outcomes. Without the substitution it fails with
`shard command exited 127`; with the substitution it passes.

Explicit `stdout: "piped"` and `stderr: "piped"` options were removed because
`Deno.Command.output()` already defaults to piped output.

The OOM documentation now states that initial exit 133/134/137/143 or a
fatal-OOM log triggers one retry, while final exit 133/134/137/143 writes
`error:<code>` and fails the shard. The existing 133 → 137 regression
demonstrates the exhausted retry outcome; there is no second retry.

```mermaid
flowchart TD
    A[Shard test run] --> B{Final exit after any retry}
    B -->|0| C[Record passed]
    B -->|1| D[Record failed; shard remains green]
    B -->|other| E[Record error and fail shard]
    E --> F[always() uploads shard artifacts]
    C --> F
    D --> F
    F --> G[Merge coverage and JUnit]
```

## Test Plan

- `timeout 180 deno test -A --parallel test/ci/CoverageFailsPrOnTestFailure.ts test/ci/CoverageRegressionSensitivity.ts test/ci/CoverageShardMatrix.ts test/ci/CoverageShardArtifactPaths.ts test/ci/CoverageOomRetryParallel.ts < /dev/null`
  — passed. Runnable tests at head:
  - `test/ci/CoverageFailsPrOnTestFailure.ts` (10 tests at head).
  - `test/ci/CoverageRegressionSensitivity.ts` (46 tests at head, including
    imported positive controls).
  - `test/ci/CoverageShardMatrix.ts` (4 tests at head).
  - `test/ci/CoverageShardArtifactPaths.ts` (4 tests at head).
  - `test/ci/CoverageOomRetryParallel.ts` (4 tests at head).
- The same targeted command without `--parallel` also passed.
- `deno lint` and `deno check` on both changed TypeScript files — passed.
- `deno fmt --check` on both changed TypeScript files and this summary — passed.
- `markdownlint-cli2 docs/archive/pr-summaries/pr-summary-4117.md` — passed.
- Host CPU regression, before the substitution:
  `deno test -A --filter 'host CPU discovery' test/ci/CoverageRegressionSensitivity.ts < /dev/null`
  — failed as expected: `shard command exited 127`; the child suite reported
  five passed and five failed. This reproduces the PR #4122 review finding
  against the unfixed PR harness. The fixed suite passes in the command above.
- Other paths checked: the shared `runShard` harness serves all five execution
  outcomes and the sensitivity suite's imported controls. Searching `test/ci`
  for `nproc`, `CPU_CORES` and `/proc/meminfo` found no second shell-execution
  harness needing the fix. No twinned rule was found.
- `timeout 900 ./quality.sh < /dev/null` — failed at startup:
  `Native rust_scorer is required (quality.sh default) but was not found.`

<!-- vibe-quality-gate-skipped reason="full quality.sh failed at startup because native rust_scorer is unavailable; targeted checks are recorded in this summary" -->

## Deno regression avoided

- Used Deno tests and `Deno.Command` for the workflow regression harness; no
  Node tooling or lockfile dependency was added.
