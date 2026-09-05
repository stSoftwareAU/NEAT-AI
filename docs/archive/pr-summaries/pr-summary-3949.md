# Re-pin `gitleaks/gitleaks-action` to v3.0.0

## Summary

`.github/workflows/quality.yml` pinned `gitleaks/gitleaks-action` to
`ff98106e4c7b2bc287b24eaf42907196329070c7` (v2.3.9). That SHA is immutable but
frozen on the **Node 20** Actions runtime: upstream's v3 migration guide records
that from 2 June 2026 Node 20 actions need
`ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` to run at all, and from 16
September 2026 Node 20 is removed from GitHub-hosted runners, at which point a
v2 pin stops working regardless of any opt-out. The step also carries
`secrets.GITLEAKS_LICENSE`, so the secret-scan gate would go red — or silently
stop scanning — on a runtime nobody maintains.

The pin now resolves to `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` (v3.0.0), and
the trailing tag comment moves with it so the SHA stays reviewable. v3.0.0
changes **only** the runtime (`using: node20` → `node24`); inputs, outputs and
behaviour are unchanged, so `GITHUB_TOKEN` / `GITLEAKS_LICENSE` and the PR-diff
scanning behaviour carry over untouched. `actions/checkout` in this workflow is
already pinned to v6, and both jobs run on `ubuntu-latest`, so v3's runner
requirement (v2.327.1+) is met.

Supply-chain quarantine: v3.0.0 was published 2026-05-30, far beyond the 24-hour
floor.

Closes #3949.

## Evidence

Backend/CI-only change — there is no web interface to screenshot. The evidence
is the new gate test, which was observed failing against the unfixed workflow
and passing after the re-pin:

```text
# before the fix
quality.yml's gitleaks pin is off the deprecated Node 20 v2 line (Issue #3949) ... FAILED
error: AssertionError: gitleaks-action is pinned to 'v2.3.9' on line 168 —
majors below v3 run on the Node 20 runtime GitHub removes from hosted runners
on 16 September 2026

# after the fix
deno test -A "test/ci/*.ts"   →   ok | 269 passed | 0 failed (2s)
```

Full quality gate, with the native scorer built from the sibling
`NEAT-AI-scorer` checkout:

```text
./quality.sh --rust-scorer-bin=…/rust_scorer
ok | 8963 passed (5 steps) | 0 failed | 41 ignored (8m53s)
```

The pin's provenance was resolved from the upstream tag list —
`refs/tags/v3.0.0 → e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` — which matches
the SHA the issue asked for.

## Test Plan

- Added `test/ci/GitleaksActionPin.ts`:
  - `findPinnedAction` unit cases — preceding `# owner/repo@tag` comment,
    trailing comment form, action absent (returns `null`), tag comment missing
    (`tag === null`).
  - `majorVersion` unit cases — `v3.0.0`, bare `2.3.9`, `null`, non-version
    (`latest`).
  - `quality.yml pins gitleaks-action to a SHA with the resolved tag recorded` —
    the pin is a 40-char SHA and carries a resolvable tag comment.
  - `quality.yml's gitleaks pin is off the deprecated Node 20 v2 line` — the
    regression gate; fails whenever the pin falls back to a v2 tag.
- Existing gates re-run and green: `test/ci/WorkflowActionPinning.ts`,
  `test/ci/ShellcheckWorkflowPinning.ts`, `test/ci/ActionlintWorkflow.ts`, and
  the whole `test/ci/` suite.
