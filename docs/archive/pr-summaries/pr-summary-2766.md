## Summary

Bumped pinned `softprops/action-gh-release` SHA from
`3bb12739c298aeb8a4eeaf626c5b8d85266b0e65` (v2.6.2, Node 20) to
`b4309332981a82ec1c5618f44dd2e27cc8bfbfda` (v3.0.0, Node 24) in
`.github/workflows/github-release.yml` to eliminate the Node 20
runner-deprecation warning reported in #2766. Closes #2766.

## Evidence

This is a workflow/config change with no UI surface and no runtime behaviour
change — there is nothing to screenshot. Verification:

- `./quality.sh --lint-only < /dev/null` passes cleanly (formatting, linting,
  bash checks).
- `grep -n 'softprops/action-gh-release' .github/workflows/github-release.yml`
  confirms the pin now resolves to `b4309332981a82ec1c5618f44dd2e27cc8bfbfda`
  with a matching `# softprops/action-gh-release@v3.0.0 (node24 runtime)`
  comment.
- Upstream `action.yml` at `v3.0.0` declares `using: node24`, so the deprecation
  warning will no longer be emitted.

## Test Plan

- [x] `./quality.sh --lint-only < /dev/null`
- [ ] Confirm next push to `Develop` does not emit the Node 20 deprecation
      warning for `softprops/action-gh-release` in the `release` job.
