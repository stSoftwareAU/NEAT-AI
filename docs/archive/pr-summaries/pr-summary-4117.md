## Summary

Runner crashes now fail the required coverage shard after writing its error
status. The `always()` upload still publishes shard artifacts, while ordinary
test failures remain aggregated after every shard has run. Closes #4117.

The regression suite also runs against deliberately broken workflow fixtures to
verify that its checks reject wrong exits, status markers and artifacts.
Troubleshooting guidance separates the initial OOM retry triggers from the final
exit codes that fail a shard after that retry is exhausted.

Version: 7.0.68, including the automated patch increment already on the branch.

## Spec

### Intent and Rationale

- A crashed runner must make its required shard check red, because the merge job
  is not a required ruleset check.

### Essential Design Decisions

- Keep exit 1 as the ordinary test-failure signal; fail only on a final runner
  exit other than 0 or 1, after any OOM retry.
- Keep `fail-fast: false`, aggregation after shard failures, and the existing
  `always()` artifact upload.

### Undiscoverable Facts

- Graft tools were not exposed in this run; inspection used local source and
  workflow reads.

## Evidence

`test/ci/CoverageFailsPrOnTestFailure.ts` executes the parsed workflow shard
shell block with controlled runner exit codes. Before the workflow fix, the
crash cases recorded `error:139` / `error:137` but returned exit 0. With the
guard removed again, both regression tests went red at the expected nonzero exit
assertion.

`test/ci/CoverageRegressionSensitivity.ts` imports those positive controls and
adds 35 sensitivity cases. Child Deno processes run the original suite against
workflow fixtures with incorrect exits, status markers, incomplete/empty JUnit,
non-directory coverage paths, conditional/missing uploads and broken aggregation
settings. The cases require assertion failures or the specific missing-step /
missing-status diagnostic, and verify that the shard harness removes its
temporary workspace. A positive child run also checks isolation from inherited
runner state. The harness now supplies a clean shell environment so CI-level
variables cannot mask a missing fixture variable.

The redundant `nproc` stub was removed: the controlled run-plan command ignores
the core count. Explicit `stdout: "piped"` and `stderr: "piped"` options were
also removed because `Deno.Command.output()` already defaults to piped output.

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

- `timeout 180s deno test -A --parallel test/ci/CoverageFailsPrOnTestFailure.ts test/ci/CoverageRegressionSensitivity.ts test/ci/CoverageShardMatrix.ts test/ci/CoverageShardArtifactPaths.ts test/ci/CoverageOomRetryParallel.ts < /dev/null`
  — passed, 67 tests (including the imported positive controls); the same suite
  also passed without `--parallel`.
- `deno lint test/ci/CoverageFailsPrOnTestFailure.ts test/ci/CoverageRegressionSensitivity.ts`
  — passed.
- `deno check test/ci/CoverageFailsPrOnTestFailure.ts test/ci/CoverageRegressionSensitivity.ts`
  — passed.
- `deno fmt --check .github/workflows/coverage.yaml test/ci/CoverageFailsPrOnTestFailure.ts test/ci/CoverageRegressionSensitivity.ts docs/troubleshooting/CI.md`
  — passed.
- Mutation replay, using `9b2e4626` line numbers: all 40 reported mutations are
  addressed. Applying the 36 mutations to retained lines individually made the
  imported positive controls or the relevant sensitivity test fail. Lines
  `test/ci/CoverageFailsPrOnTestFailure.ts:91`, `:92`, `:104` and `:105` were
  redundant setup/defaults and have been removed. The 18 candidates beyond the
  original cap were also applied individually and all failed tests: 54 killed,
  four removed, zero survivors, no untestable exemptions. Every mutation was
  reverted before the final test run.
- `timeout 20s actionlint .github/workflows/coverage.yaml` — passed.
- Crash regression red check with the `exit "$TEST_EXIT_CODE"` guard removed:
  `deno test -A --filter 'unexpected runner crashes' test/ci/CoverageFailsPrOnTestFailure.ts < /dev/null`
  — failed as expected (actual exit 0, expected 139; `error:139` was written).
  The exhausted OOM retry check likewise failed (actual 0, expected 137;
  `error:137` was written). Guard restored; both pass in the final test run.
- `timeout 900s ./quality.sh < /dev/null` — could not start the full gate:
  `Native rust_scorer is required (quality.sh default) but was not found.` The
  sibling scorer checkout and `$HOME/.cargo/bin/rust_scorer` are absent. GitHub
  Actions CI remains pending.

<!-- vibe-quality-gate-skipped reason="full quality.sh requires native rust_scorer, which is absent from PATH, the sibling checkout, and $HOME/.cargo/bin; targeted Deno checks and actionlint passed" -->

## Deno regression avoided

- Used Deno tests and `Deno.Command` for the workflow regression harness; no
  Node tooling or lockfile dependency was added.
