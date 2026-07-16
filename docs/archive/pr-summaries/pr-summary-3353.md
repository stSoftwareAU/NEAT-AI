## Summary

The `release` job in `.github/workflows/github-release.yml` checked out the
repository without `persist-credentials: false`. By default `actions/checkout`
writes the workflow `GITHUB_TOKEN` into `.git/config` as an auth header, where
any later step in the job could read it. This job only reads the version from
`deno.json` and creates a GitHub Release via `softprops/action-gh-release`
(which authenticates with the token passed via env, not from `.git/config`); it
never pushes back or fetches private submodules, so the persisted credential is
not needed and only widens the blast radius of a compromised step.

Added `persist-credentials: false` to the checkout step so the token is never
written to disk. Closes #3353.

## Evidence

Backend/CI-only change — no web interface to screenshot. Verified via the
existing `test/ci/WorkflowPersistCredentialsFalse.ts` suite, extended with a
scoped test for the `release` job. The new test fails against the unfixed
workflow and passes after the fix:

```
.github/workflows/github-release.yml checkout must set persist-credentials: false (Issue #3353) ... ok
ok | 9 passed | 0 failed
```

```mermaid
flowchart LR
    A[push to Develop] --> B[checkout<br/>persist-credentials: false]
    B --> C[read version from deno.json]
    C --> D[softprops/action-gh-release<br/>token via env]
```

## Test Plan

- Added `test/ci/WorkflowPersistCredentialsFalse.ts` →
  `.github/workflows/github-release.yml checkout must set persist-credentials:
  false (Issue #3353)`, which asserts the `release` job's checkout step sets
  `persist-credentials: false`. Confirmed it fails on the pre-fix workflow and
  passes after the change.
