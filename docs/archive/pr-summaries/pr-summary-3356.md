## Summary

The `semgrep` job in `.github/workflows/semgrep.yml` checked out the repository
with `actions/checkout` at its default `persist-credentials: true`, which writes
the workflow `GITHUB_TOKEN` into `.git/config` as an auth header. This job only
reads the tree to run a Semgrep SAST scan (authenticated separately via
`SEMGREP_APP_TOKEN`); it never pushes back or fetches private submodules, so the
persisted credential is unnecessary and only widens the blast radius of a
compromised step.

Added `persist-credentials: false` to the checkout step so the token is never
written to disk. This matches the existing hardening already applied to the
other read-only workflows in this repo (bench, coverage, dependency-review,
github-release, markdown-lint). Closes #3356.

## Evidence

Backend/CI-only change — no web interface to screenshot.

```mermaid
flowchart LR
    A[checkout<br/>persist-credentials: false] --> B[semgrep ci scan]
    A -. token NOT written<br/>to .git/config .-> C[(.git/config)]
```

Verification:

- `deno test --allow-read test/ci/WorkflowPersistCredentialsFalse.ts` — 11
  passed, 0 failed, including the new Issue #3356 case.
- `actionlint .github/workflows/semgrep.yml` — exit 0.
- `deno fmt --check`, `deno lint`, `deno check` on the modified test file — all
  clean.

## Test Plan

- Added `test/ci/WorkflowPersistCredentialsFalse.ts` →
  `.github/workflows/semgrep.yml checkout must set persist-credentials: false
  (Issue #3356)`,
  which parses the workflow and asserts the `semgrep` job's checkout step sets
  `persist-credentials: false`. It fails against the unfixed workflow (default
  `undefined`) and passes after the fix.
