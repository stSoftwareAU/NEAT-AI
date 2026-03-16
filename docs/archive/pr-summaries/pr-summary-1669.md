## Summary

Replace one-shot CRISPR consumption (`pop()`) with round-robin cycling across
generations, so that CRISPRs are not permanently destroyed and failed CRISPRs
can be retried on mutated creatures in later generations. Adds a configurable
`maxCRISPRsPerGeneration` option (defaults to 1 for backward compatibility).
Closes #1669.

### Changes

- **`src/NEAT/NeatEvolution.ts`**: Replaced `pop()`-based consumption loop with
  index-based cycling. Each generation tries up to `maxCRISPRsPerGeneration`
  CRISPRs from the array without removing them. The existing `cleaveDNA()`
  idempotency guard (CRISPR tags on neurons/synapses) prevents
  double-application to the same creature.
- **`src/NEAT/Neat.ts`**: Made `CRISPRs` array `readonly`. Added `crisprIndex`
  for round-robin tracking across generations.
- **`src/config/NeatArguments.ts`**: Added `maxCRISPRsPerGeneration` field.
- **`src/config/NeatConfig.ts`**: Parse `maxCRISPRsPerGeneration` with default
  of 1.
- **`src/config/NeatOptions.ts`**: Added `maxCRISPRsPerGeneration` to
  `NumericOptionKeys` for CLI coercion support.

## Evidence

This is a backend/logic change with no visual output. All 4385 tests pass
including the new CRISPR cycling tests and all existing CRISPR tests (Inject,
CRISPR, CRISPR_twice, REMOVE, etc.).

## Test Plan

- **`test/CRISPR/CRISPRCycling.ts`** (new, 5 tests):
  - `CRISPR cycling - CRISPRs survive across generations`: Verifies the original
    CRISPRs array is not consumed/modified
  - `CRISPR cycling - failed CRISPR retryable on mutated creature`: Unit-level
    test that cleaveDNA's idempotency guard works correctly and fresh creatures
    can receive the same CRISPR
  - `CRISPR cycling - default maxCRISPRsPerGeneration is 1`: Verifies
    backward-compatible default behaviour
  - `CRISPR cycling - multiple CRISPRs per generation`: Tests
    `maxCRISPRsPerGeneration=2` applies both CRISPRs
  - `CRISPR cycling - round-robin across generations`: Verifies CRISPRs are
    tried in round-robin order across generations
- All existing CRISPR tests continue to pass unchanged
