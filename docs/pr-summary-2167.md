## Summary

Invalid CRISPR DNA (e.g., append-mode synapses missing source references) no
longer crashes the entire evolution process. Instead, the evolution loop catches
`CrisprError`, logs a warning with the CRISPR ID and error message, and skips
the invalid CRISPR — allowing the remaining CRISPRs and evolution to continue
normally. Closes #2167.

## Changes

- **`src/NEAT/NeatEvolution.ts`**: Wrapped `crispr.cleaveDNA(dna)` in a
  try/catch that catches `CrisprError`, logs a warning, and continues the loop.
  Non-CRISPR errors are re-thrown.
- **`test/NEAT/EvolveCrisprWarning.ts`**: Added two tests verifying that invalid
  CRISPR DNA warns instead of crashing, and that valid CRISPRs still apply after
  skipping invalid ones.

## Evidence

Tests reproduce the exact `CrisprError` from the issue logs and verify evolution
completes successfully:

- `evolve: invalid CRISPR DNA warns instead of crashing (#2167)` — passes
- `evolve: valid CRISPRs still apply after skipping invalid ones (#2167)` —
  passes

## Test Plan

- Added `test/NEAT/EvolveCrisprWarning.ts` with two test cases
- All 5265 existing tests continue to pass
- Quality gate (`./quality.sh`) passes cleanly
