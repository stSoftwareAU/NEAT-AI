# Archived PR summaries

This directory is the canonical home for per-PR summary files
(`pr-summary-<issue>.md`), as set out in Issue #2173. Each summary is a
write-once release note for a single change — not topic documentation — so it is
kept here rather than at the `docs/` root.

## Policy

- **New PR summaries land here**, named `pr-summary-<issue>.md`.
- **They are not indexed** by [`docs/README.md`](../../README.md); browse a
  summary via the merged PR or `git log`.
- **Historical summaries were pruned** (Issue #2958). The ~696 obsolete
  `pr-summary-*.md` files that previously lived at the `docs/` root and in this
  directory were deleted — they remain permanently available in GitHub's PR
  history, so the working-tree copies were noise. Only the historical
  `pr-summary-*.md` files were removed; sibling archive material
  (`docs/archive/research/`, `docs/archive/investigations/`) was left untouched.
