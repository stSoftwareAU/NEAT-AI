## Summary

Enable `retry-on-snapshot-warnings` in the GitHub dependency review workflow to
fix the "Snapshot Warnings" that appear on pull requests when the dependency
graph snapshot is not yet ready for the head SHA. Closes #2083.

## Evidence

The dependency-review-action was producing warnings like "No snapshots were
found for the head SHA" and recommending enabling `retry-on-snapshot-warnings`.
The fix uncomments the already-present (but disabled) configuration option so
the action retries until the snapshot is available instead of emitting a warning.

## Test Plan

- This is a CI configuration change — the behaviour is exercised by the
  dependency-review-action when it runs on future PRs.
- Verified the workflow YAML is valid and lint-clean.
