## Summary

Merge milestone `fuzz_and_quantisation` to Develop. Closes #1908.

This milestone introduces training data fuzzing (noise injection) and
quantisation features to prevent network memorisation, along with documentation
updates.

### Closed issues in this milestone

- #1903: Audit and update all documentation
- #1901: Training data quantisation to prevent memorisation
- #1900: Training data fuzzing (noise injection) to prevent memorisation

## Changes

- **Data Fuzzing** (`src/propagate/DataFuzzing.ts`,
  `src/config/DataFuzzingConfig.ts`) — Adds configurable Gaussian noise
  injection to training data, forcing networks to learn robust patterns rather
  than memorising exact values.
- **Data Quantisation** (`src/propagate/DataQuantisation.ts`,
  `src/config/DataQuantisationConfig.ts`) — Rounds continuous values to discrete
  levels, the deterministic complement to fuzzing.
- **Configuration wiring** — Both features integrated into `NeatArguments`,
  `NeatOptions`, `NeatConfig`, `NeatConfigParsers`, `TrainOptions`,
  `Training.ts`, and `PredictiveCodingTrainer.ts`.
- **Documentation** — Comprehensive audit updating API reference, configuration
  guide, troubleshooting guide, and README. PR summary files archived to
  `docs/archive/pr-summaries/`.
- **Public API** — New exports added to `mod.ts` for both feature configs and
  utilities.

## Evidence

All 4755 tests pass, including new tests for fuzzing and quantisation:

- `test/propagate/DataFuzzing.ts` — Unit tests for noise injection
- `test/propagate/DataFuzzingIntegration.ts` — Integration tests for fuzzing in
  training
- `test/propagate/DataQuantisation.ts` — Unit tests for quantisation

## Test Plan

- All existing tests continue to pass (4755 passed, 0 failed)
- No new tests required for this merge PR — tests were added in the constituent
  PRs
