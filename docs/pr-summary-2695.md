# Pin `ludeeus/action-shellcheck` to a commit SHA

## Summary

`.github/workflows/shellcheck.yml` previously referenced
`ludeeus/action-shellcheck@master` — a moving ref that would execute any
new commit on the upstream branch inside our CI on the next run. This is
the highest-severity supply-chain class of pinning issue.

The pin has been replaced with the 40-character commit SHA of the
upstream `2.0.0` release tag, matching the pattern already in use in
`markdown-lint.yml`. A nearby comment names the resolved tag so
reviewers can verify provenance against the upstream release page.

Closes #2695.

## Evidence

Backend/CI-only change — no UI to screenshot. The change is verifiable
by reading the workflow file and running the new tests under
`test/ci/ShellcheckWorkflowPinning.ts`.

Before:

```yaml
uses: ludeeus/action-shellcheck@master
```

After:

```yaml
# ludeeus/action-shellcheck@2.0.0
uses: ludeeus/action-shellcheck@00cae500b08a931fb5698e11e79bfbd38e612a38
```

The SHA `00cae500b08a931fb5698e11e79bfbd38e612a38` resolves to the
upstream `2.0.0` tag on `ludeeus/action-shellcheck`, confirmed via
`gh api repos/ludeeus/action-shellcheck/git/refs/tags/2.0.0`.

## Test Plan

New regression tests added in `test/ci/ShellcheckWorkflowPinning.ts`:

- `extractUses parses a uses line` — unit test of the helper.
- `extractUses returns empty for no uses lines` — unit test boundary.
- `extractUses captures multiple actions` — unit test of multi-match.
- `shellcheck.yml pins ludeeus/action-shellcheck to a 40-char commit SHA (Issue #2695)` —
  reads the real workflow and asserts the ref matches `^[0-9a-f]{40}$`
  and is not `master`/`main`.
- `shellcheck.yml records the resolved tag in a comment for reviewer provenance (Issue #2695)` —
  asserts a `# ludeeus/action-shellcheck@<tag>` provenance comment is
  present.

Verified the test set fails against the unfixed file (when restoring
`@master`, both pinning tests fail) and passes against the fix.

The pre-existing `DiscoveryTimeout` test failure observed in
`./quality.sh` is unrelated to this change — it reproduces on a clean
checkout of `Develop` without these edits.

## Acceptance criteria

- [x] `shellcheck.yml` no longer references `@master` (or any other moving ref).
- [x] The pin is a 40-character commit SHA, with a comment naming the resolved tag (`2.0.0`).
