## Summary

Update CONFIGURATION_GUIDE.md with 7 missing configuration parameters that have
JSDoc in NeatArguments.ts but were not reflected in the user-facing
documentation. Closes #1758.

### Changes

- Added `maxCRISPRsPerGeneration` to Core Evolution Quick Reference table and
  body section
- Added `discoveryReplayRescoreBaseline` body section (was already in Quick
  Reference table)
- Added `discoveryMinCandidatesPerCategory` to the Discovery Quick Reference
  table
- Created new "Discovery Debug Options" Quick Reference table and body section
  with:
  - `discoveryBaseDirectory`
  - `discoverySkipRecordPhase`
  - `discoveryDisableCleanup`
  - `discoveryDisableEvaluationSummaryLogging`
- Updated Table of Contents with Discovery Debug Options entry

## Evidence

Documentation-only change. All descriptions match JSDoc in
`src/config/NeatArguments.ts`. Australian English spelling used throughout
(optimisation, etc.).

## Test Plan

- Verified `./quality.sh --lint-only` passes (formatting and linting)
- No code changes; documentation only
