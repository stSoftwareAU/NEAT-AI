## Summary

Adds the dedicated **Deno Dependency Updates** workflow at
`.github/workflows/deno-outdated.yml` so the workflow-sync detector finds the
expected `deno-outdated` automation in addition to the existing inline
`deno outdated` step in `quality.yml`. The new workflow runs
`deno outdated --update --latest` on a weekly cron (06:00 UTC every Monday) and
on manual dispatch, then opens a PR via `peter-evans/create-pull-request@v7` on
the `chore/deno-outdated` branch with `contents: write` and
`pull-requests: write` permissions, matching the template in the issue.

Closes #2362.

## Evidence

This is a CI/automation change with no UI surface, so no screenshot is
attached. Evidence of correctness:

- `deno test --allow-read test/scripts/DenoOutdatedWorkflow.ts` passes all six
  cases against the new workflow file (file presence, schedule + dispatch
  triggers, write permissions, checkout + setup-deno steps, the
  `deno outdated --update --latest` invocation, and the
  `peter-evans/create-pull-request` step on the `chore/deno-outdated` branch).
- `./quality.sh --lint-only` passes (deno fmt, deno lint, bash syntax all
  green).
- `./quality.sh --check-only` passes (deno check across the workspace).

## Test Plan

- Added `test/scripts/DenoOutdatedWorkflow.ts` with six cases covering:
  - workflow file exists at `.github/workflows/deno-outdated.yml`
  - triggers on `schedule` (cron) and `workflow_dispatch`
  - grants `contents: write` and `pull-requests: write`
  - uses `actions/checkout` and `denoland/setup-deno`
  - runs `deno outdated --update --latest`
  - opens a PR via `peter-evans/create-pull-request` on the
    `chore/deno-outdated` branch
