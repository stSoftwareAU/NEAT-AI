## Summary

The shard partition parity gate (`shard_test_files.ts --verify`) and the
lost-coverage check ran only in `Merge coverage & results`, which neither the
`Develop` nor the milestone ruleset requires. Both now also run inside each
required `Coverage shard <n>` job, so a failure turns a required check red. The
merge-job copies stay as defence in depth. Closes #4125.

Version bump: `deno.json` version updated for this change; the merged commit
records the final version.

## Spec

### Intent and Rationale

- Moving the checks into the already-required shard job needs no ruleset change
  (a repository setting this PR cannot make) and keeps the fix reviewable in the
  workflow file.

### Essential Design Decisions

- A shard runs `--verify --total="${SHARD_TOTAL}"` before listing its slice. On
  failure it writes `error:partition` and exits 1 before any test runs.
  `--verify` only lists files and plans, so eight repeats are cheap.
- After the status chain, a shard whose `coverage-<shard>/` is absent writes
  `error:no-coverage` and exits 1. The crash branch already exits earlier, so
  this covers `passed` and `failed` (exit 1 test failures).
- The merge gate counts any status other than `passed`/`failed` as errored, so
  the new markers need no merge-job change.

### Undiscoverable Facts

- The per-shard directory check cannot see a directory the artifact upload then
  drops (the #3550 case). That stays covered by the merge gate and by
  `test/ci/CoverageShardArtifactPaths.ts`.

## Evidence

Backend/CI-only change; no UI. The tests execute the committed "Run test shard"
shell block with a fake `deno`.

```text
deno test -A test/ci/CoverageRegressionSensitivity.ts < /dev/null
ok | 66 passed | 0 failed
```

`test/ci/CoverageRegressionSensitivity.ts` (66 tests at head, including imported
shard tests) passed. The suite imports `test/ci/CoverageFailsPrOnTestFailure.ts`
and exercises its assertions against fault-injected workflow copies.

```mermaid
flowchart TD
    A[Shard starts] --> B{"--verify passes?"}
    B -- no --> E1["error:partition, exit 1"]
    B -- yes --> C[Run slice]
    C --> D{Final exit}
    D -- other than 0/1 --> E2["error:code, exit code"]
    D -- "0 or 1" --> F{"coverage-n/ exists?"}
    F -- no --> E3["error:no-coverage, exit 1 (new)"]
    F -- yes --> G[passed / failed, step green]
```

## Test Plan

- `test/ci/CoverageFailsPrOnTestFailure.ts` (harness `runShard` gained a
  trailing `{ verifyExit, skipCoverage }` options argument after the base
  branch's `oomRuns` (Issue #4124); no existing assertion removed or edited):
  - a failed partition check → `error:partition`, exit 1, `runs` 0; positive
    control with `verifyExit: 0` → `passed`, `runs` 1.
  - passing run that loses its coverage dir → `error:no-coverage`, exit 1.
  - ordinary exit-1 failure that loses its coverage dir → `error:no-coverage`,
    exit 1 (the dir check precedes the green `failed` outcome).
- `test/ci/CoverageRegressionSensitivity.ts` registers the three new shard cases
  for exit, status and coverage faults. Missing-directory cases inject
  `mkdir -p coverage-0`; exit faults inject `exit 0`. Partition faults also
  exercise the run count and the passing control separately, so a later
  assertion cannot hide removal of an earlier one.
- Fake mirrors the real callee: real `--verify` throws (non-zero exit) with the
  cause on stderr and prints OK otherwise (`scripts/shard_test_files.ts`
  `main`).
- Twinned copies: merge-job `Verify shard partition parity` and
  `coverage_merge_gate.ts` are retained; comments note the per-shard copy.
  `docs/troubleshooting/CI.md` and `CHANGELOG.md` updated.
- `timeout 1200 ./quality.sh < /dev/null` failed immediately:
  `Native rust_scorer is required (quality.sh default) but was not found.` The
  full suite did not run; targeted checks are recorded below.

- Targeted `deno fmt --check`, `deno lint` and `deno check` passed for the
  changed test; formatting also passed for this summary. Markdown lint passed
  with `deno run --no-config --no-lock -A npm:markdownlint-cli2@0.23.2`.

## Mutation check

`test/ci/CoverageRegressionSensitivity.ts` imports the shard regression suite;
its workflow faults make the new assertions mutation-sensitive. Each assertion
below was deleted individually, the matching sensitivity test was run, and the
original file was restored. Every run exited 1 with
`AssertionError: Values are not equal` because the child test incorrectly passed
against a broken workflow.

- `test/ci/CoverageFailsPrOnTestFailure.ts:284` status, `:285` exit, `:286` run
  count and `:287` absent coverage: killed by partition faults.
- `test/ci/CoverageFailsPrOnTestFailure.ts:291` exit, `:292` status, `:293` run
  count and `:294` coverage: killed by faults scoped to the passing control.
- `test/ci/CoverageFailsPrOnTestFailure.ts:299` status, `:300` exit and `:301`
  absent coverage: killed by passing-run lost-coverage faults.
- `test/ci/CoverageFailsPrOnTestFailure.ts:306` status, `:307` exit and `:308`
  absent coverage: killed by ordinary-failure lost-coverage faults.

All 14 assertion-deletion mutants were killed. The earlier assertion exemptions
and obsolete harness line references have been removed.

Branch outcomes: existing present-directory/JUnit fault cases remain covered;
the new absent-directory cases select directory-creation faults and omit JUnit
faults. Only the partition scenario selects the run-count and passing-control
faults. The complete sensitivity suite exercises both choices for each added
condition. No workflow, public API or persisted format changes in this review
fix. The per-shard and merge-job gate copies remain unchanged.
