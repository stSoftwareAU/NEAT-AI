## Summary

Closed stale milestone PRs and deleted feature branches that had diverged
significantly from Develop. The "Performance Improvements" milestone (#2062)
attempted to merge 6 performance optimisations via a milestone branch, but the
branch diverged due to many fixes landing since (UUID changes, memetic pruning,
validation changes, etc.), and the merge PRs were failing CI. Each optimisation
is now being re-implemented individually against the current Develop branch
(#2122, #2123, #2124, #2125, #2126, #2127). Closes #2128.

## Actions taken

- Closed PR #2063 ("Milestone: Performance Improvements") with explanatory
  comment
- Closed PR #2064 ("Merge milestone 'Performance Improvements' to Develop
  (#2062)") with explanatory comment
- Closed issue #2062 ("Merge milestone 'Performance Improvements' to Develop")
  with explanatory comment
- Deleted branch `milestone/performance-improvements`
- Deleted branch
  `issue-2062-merge-milestone-performance-improvements-to-develop`

## Evidence

All items verified as closed/deleted via `gh` CLI:

- PR #2063: CLOSED
- PR #2064: CLOSED
- Issue #2062: CLOSED
- Branch `milestone/performance-improvements`: 404 (deleted)
- Branch `issue-2062-merge-milestone-performance-improvements-to-develop`: 404
  (deleted)

## Test Plan

No code changes were made - this is a GitHub housekeeping task. No tests needed.
