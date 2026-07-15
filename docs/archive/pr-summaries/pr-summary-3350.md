## Summary

The `coverage` shard job in `.github/workflows/coverage.yaml` checked out the
repository with `actions/checkout`'s default `persist-credentials: true`, which
writes the workflow `GITHUB_TOKEN` into `.git/config` as an auth header. That
job only reads the repo, syncs the WASM bundle, runs its test slice, and uploads
an artifact — it never pushes back or fetches private submodules — so the
persisted token only widened the blast radius of a compromised step (e.g. a
later step running PR-controlled code such as `./build.sh --verify-only`).

This PR sets `persist-credentials: false` on the coverage-job checkout so the
token never lands on disk. Scoped to the `coverage` job only; the sibling
`merge` job's checkout is tracked separately as Issue #3351.

Closes #3350.

## Evidence

Backend/CI change only — no web interface to screenshot. Verified via the new
scoped unit test plus lint and the CI workflow test suite.

```mermaid
flowchart LR
    A[actions/checkout<br/>persist-credentials: false] --> B[Setup Deno]
    B --> C[Sync WASM]
    C --> D[Run test shard]
    D --> E[Upload artifact]
    A -. token NOT written<br/>to .git/config .-> X[(No on-disk<br/>GITHUB_TOKEN)]
```

Test run:

```
.github/workflows/coverage.yaml coverage-job checkout must set persist-credentials: false (Issue #3350) ... ok
ok | 6 passed | 0 failed
```

## Test Plan

- Added `test/ci/WorkflowPersistCredentialsFalse.ts` →
  `".github/workflows/coverage.yaml coverage-job checkout must set persist-credentials: false (Issue #3350)"`,
  which parses the workflow YAML and asserts every `actions/checkout` step in
  the `coverage` job sets `persist-credentials: false`. Confirmed it fails
  against the unfixed workflow (`undefined` vs `false`) and passes after the
  fix.
- Re-ran the full `WorkflowPersistCredentialsFalse.ts` suite (6 passed).
- Ran `test/ci/ActionlintWorkflow.ts`, `test/ci/WorkflowActionPinning.ts`, and
  `test/ci/CoverageShardMatrix.ts` (16 passed) to confirm no regression.
- `./quality.sh --lint-only` passes (format, lint, bash syntax).
