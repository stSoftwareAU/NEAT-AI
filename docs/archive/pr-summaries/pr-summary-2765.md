## Summary

Bumped `actions/setup-node` from the previously pinned v4 SHA
(`49933ea5288caeca8642d1e84afbd3f7d6820020`, node20 runtime) to **v6.4.0**
(`48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`, node24 runtime) in
`.github/workflows/markdown-lint.yml` to clear the runner Node.js 20 deprecation
warning. Closes #2765.

The pinned SHA is verified against `actions/setup-node` v6.4.0 (released
2026-04-20, past the 24h supply-chain quarantine) and its `action.yml` declares
`runs.using: 'node24'`.

## Evidence

- Single workflow file changed: `.github/workflows/markdown-lint.yml`.
- Verified upstream runtime via the GitHub API:

```
runs:
  using: 'node24'
```

- Comment above the `uses:` line updated to reflect the new version
  (`actions/setup-node@v6.4.0`).
- No code changes; CI surface only. The `Markdown Lint` workflow run on this PR
  is the regression check — its log should no longer contain the
  `Node.js 20 actions are deprecated` warning for `actions/setup-node`.

## Test Plan

- [x] `markdown-lint.yml` workflow continues to set up Node and run
      `markdownlint-cli2` (no behavioural change).
- [x] Pinned SHA matches the `v6.4.0` git tag of `actions/setup-node`.
- [x] Comment line above the pin records the version tag matching the SHA.
- [ ] On PR merge, confirm the next `Markdown Lint` run no longer emits the
      `Node.js 20 actions are deprecated` warning for `actions/setup-node`.
