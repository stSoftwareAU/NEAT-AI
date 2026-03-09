## Summary

Add per-changeType discovery diagnostics that track candidate success/failure rates across discovery evaluation runs. After each discovery run, a summary table is logged showing evaluated count, improved count, success rate percentage, and average score delta per change type. Diagnostics are also persisted to `diagnostics.json` alongside the candidate archive for trend analysis. Closes #1735.

## Changes

- **New module**: `src/discovery/DiscoveryDiagnostics.ts` — aggregation, formatting, logging, and file persistence for per-changeType diagnostics
- **Integration**: `src/discovery/DiscoveryRunner.ts` — calls diagnostics aggregation and logging after evaluation, persists to archive directory when available

## Evidence

All 4661 tests pass (including 12 new diagnostics tests) with zero failures. No performance-sensitive I/O in hot paths — diagnostics are computed once from the already-collected evaluation results array after scoring completes.

## Test Plan

- Added `test/discovery/DiscoveryDiagnostics.ts` with 12 tests covering:
  - Empty results (no candidates)
  - Single success and single failure tracking
  - Mixed results for same change type (success rate + average delta)
  - Multiple change types tracked independently
  - Original results ignored (only candidates counted)
  - Equal score treated as failure (not improved)
  - Combo types tracked correctly
  - Candidates without change type skipped
  - Empty diagnostics table formatting
  - Single and multiple entry table formatting
