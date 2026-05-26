# Add CI lint gate for `github-actions` bucket

## Summary

Adds `.github/workflows/actionlint.yml`, a CI lint gate that runs the standard
GitHub Actions linter (`actionlint`) on every push and pull request so workflow
regressions fail the build before they merge. Without this gate, mistakes in any
other workflow file (mistyped expressions, missing `permissions:` blocks,
unsupported runner labels, shell-script issues inside `run:` blocks) would only
surface the next time that workflow runs — often long after the offending PR
merged.

Closes #2762.

## Deno regression avoided

The new lint gate was wired up entirely with GitHub Actions and the existing
Deno-based CI helpers — no `package.json`, `npx`, or other Node-only tooling was
introduced.

## Evidence

This is a CI-only change (no UI, no runtime hot path), so evidence is the new
tests under `test/ci/ActionlintWorkflow.ts` which pin down the expected shape of
the workflow:

- The workflow file exists at `.github/workflows/actionlint.yml`.
- It triggers on both `pull_request` and `push`.
- It declares a least-privilege `contents: read` permission block.
- At least one step invokes `actionlint` (via `raven-actions/actionlint`).
- It checks out the repository before linting.

All 43 tests under `test/ci/` continue to pass, including the existing
`WorkflowActionPinning` and `WorkflowContainerImagePinning` invariants that the
new workflow respects.

```mermaid
flowchart LR
    A[push / PR] --> B[actionlint.yml]
    B --> C[checkout repo<br/>persist-credentials: false]
    C --> D[raven-actions/actionlint@v2.1.2<br/>pinned to 40-char SHA]
    D --> E{findings?}
    E -- yes --> F[fail build]
    E -- no --> G[pass]
```

## Test Plan

- Added `test/ci/ActionlintWorkflow.ts` with five assertions covering file
  existence, triggers, permissions, the actionlint invocation, and the checkout
  step.
- Verified the new workflow is pinned to a 40-char commit SHA with a
  resolved-tag comment, so the existing `WorkflowActionPinning` test (Issue
  #2696) keeps passing.
- Ran `deno fmt`, `deno lint`, and `deno check` on the new files.
- Ran the full `test/ci/` suite: 43 passed, 0 failed.
