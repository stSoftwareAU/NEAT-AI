## Summary

The `Test Coverage` CI workflow (`.github/workflows/coverage.yaml`) ran the full
test suite under coverage instrumentation with a 30-minute job cap. Heavy runs
occasionally exceeded 30 minutes on slower runners, so GitHub killed the job and
the PR failed spuriously. This PR raises the `timeout-minutes` for the
`coverage` job from 30 to 60 (a full hour), while staying well under the 6-hour
GitHub default that the existing hygiene test guards against. Closes #3168.

## Evidence

Backend/CI-only change — no web interface to screenshot.

- Workflow diff: `timeout-minutes: 30` → `timeout-minutes: 60` in the `coverage`
  job.
- `actionlint .github/workflows/coverage.yaml` passes clean.
- New test result:

```
running 3 tests from ./test/ci/WorkflowJobTimeoutMinutes.ts
at least one workflow file is present to validate ... ok
every workflow job declares an explicit timeout-minutes ... ok
coverage workflow job allows at least an hour (Issue #3168) ... ok

ok | 3 passed | 0 failed
```

## Test Plan

- Added
  `test/ci/WorkflowJobTimeoutMinutes.ts::coverage workflow job allows
  at least an hour (Issue #3168)`
  — parses the committed `coverage.yaml` and asserts the `coverage` job's
  `timeout-minutes` is at least 60. Fails against the previous value of 30,
  passes after the change.
- Existing generic test
  (`every workflow job declares an explicit
  timeout-minutes`) still passes: 60
  remains a positive integer below the 360-minute default.
