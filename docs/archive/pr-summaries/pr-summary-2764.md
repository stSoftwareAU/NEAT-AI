## Summary

Bumped `peter-evans/create-pull-request` from `v7.0.11`
(`22a9089034f40e5a961c8808d113e2c98fb63676`) to `v8.1.1`
(`5f6978faf089d4d20b00c7766989d076bb2fc7f1`) in
`.github/workflows/deno-outdated.yml`. The v7 release shipped with the
deprecated `node20` runtime; v8.1.1 ships with `node24`, clearing the
GitHub runner deprecation warning surfaced on run 26389601634 and
keeping the workflow ahead of the 2026-09-16 node20 removal date.
Closes #2764.

## Evidence

This is a CI workflow change — no UI, no benchmark. Verification:

- `gh api repos/peter-evans/create-pull-request/contents/action.yml?ref=v8.1.1`
  confirms `runs.using: 'node24'`.
- `gh api repos/peter-evans/create-pull-request/git/refs/tags/v8.1.1`
  resolves the tag to commit
  `5f6978faf089d4d20b00c7766989d076bb2fc7f1`, which is what the workflow
  now pins.
- Existing CI tests pass (see Test Plan).

The trailing-comment form `# peter-evans/create-pull-request@v8.1.1
(node24 — Issue #2764)` keeps the `WorkflowActionPinning` provenance
check happy — the comment still resolves the SHA to a named tag for
reviewers.

## Test Plan

- `deno test --allow-read test/ci/WorkflowActionPinning.ts
  test/ci/DenoOutdatedWorkflowQuarantine.ts` — 10/10 pass. Covers:
  - Every `uses:` is pinned to a 40-char SHA (Issue #2696).
  - Each pinned action records the resolved tag in a nearby comment
    (Issue #2696).
  - `deno-outdated.yml` still carries `--minimum-dependency-age` and
    `VIBE_BUMP_QUARANTINE_HOURS` (Issue #2741) — unchanged by this bump.
