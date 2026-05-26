## Summary

Bumped `actions/upload-artifact` from v4.6.2 to v7.0.1 in
`.github/workflows/coverage.yaml` to clear the runner deprecation warning for
Node.js 20 actions. v6 moved the action's runtime to Node 24
(`runs.using: node24`), and v7.0.1 keeps that runtime while adding the new
`archive` parameter (default `true`, so the existing call site is
backward-compatible). Closes #2767.

The action is pinned to commit SHA `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
per the supply-chain guideline that GitHub Actions must be pinned to a 40-char
SHA rather than a version tag.

## Evidence

This is a workflow-only change — no application code or UI. The fix is verified
by the bundled `actionlint` workflow on PR creation, which parses every workflow
file and would flag any syntax or schema regression in the bumped step.

Before:

```yaml
# actions/upload-artifact@v4.6.2
uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
```

After:

```yaml
# actions/upload-artifact@v7.0.1 — Node 24 runtime (Issue #2767)
uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
```

The `with:` block (`name: test-results`, `path: junit.xml`,
`retention-days: 30`) is unchanged — all three parameters are still supported in
v7.

Release-note linkage:

- v6.0.0 — moves the action onto Node.js 24.
- v7.0.0 — ESM upgrade and the optional `archive` parameter; defaults preserve
  the prior zip-and-upload behaviour.
- v7.0.1 — README / dependency bumps only.

## Test Plan

- `./quality.sh --lint-only < /dev/null` — passes (formatting, linting, and bash
  shellcheck all green).
- The `actionlint` workflow (`.github/workflows/actionlint.yml`) will re-parse
  `coverage.yaml` on PR open and fail the job on any schema regression
  introduced by the bump.
- No unit-test changes — the modified file is a CI workflow, not source code, so
  there is no function to write a Deno test against. Behavioural verification
  happens when the workflow runs on the next push to the milestone branch.
