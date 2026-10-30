## Summary

Runner crashes now fail the required coverage shard after writing its error
status. The `always()` upload still publishes shard artifacts, while ordinary
test failures remain aggregated after every shard has run. Closes #4117.

Version bump: none for this workflow-only change.

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

- `timeout 120s deno test -A test/ci/CoverageFailsPrOnTestFailure.ts test/ci/CoverageShardMatrix.ts test/ci/CoverageShardArtifactPaths.ts test/ci/CoverageOomRetryParallel.ts < /dev/null`
  — passed, 22 tests.
- `timeout 120s deno lint test/ci/CoverageFailsPrOnTestFailure.ts` — passed.
- `timeout 120s deno check test/ci/CoverageFailsPrOnTestFailure.ts` — passed.
- `timeout 30s deno fmt --check .github/workflows/coverage.yaml test/ci/CoverageFailsPrOnTestFailure.ts docs/troubleshooting/CI.md`
  — passed.
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
