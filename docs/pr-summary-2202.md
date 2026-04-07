## Summary

Add integration tests verifying MCMC convergence behaviour across the full pipeline. Closes #2202.

These tests validate that the MCMC components (MCMCConfig, MetropolisHastings, MCMCDiagnostics, MCMCState) work together correctly in realistic scenarios:

- Acceptance rate converges toward the target (~23.4%) with adaptive temperature tuning
- Temperature decreases monotonically via exponential cooling and respects minimum bound
- MCMC disabled produces identical results across runs with the same seed (backward compatibility)
- High temperature accepts worsening mutations; low/zero temperature rejects them (greedy vs probabilistic)
- Rejected mutations revert the creature and diagnostics track decisions correctly
- Full lifecycle with cooling, adaptive tuning, and diagnostics integration
- Weight/bias penalty proxy is consistent with weight magnitude

## Evidence

All 8 new integration tests pass. Full quality gate (`./quality.sh`) passes with 5440 tests, 0 failures.

## Test Plan

- `test/NEAT/MCMCConvergenceIntegration.ts` — 8 integration tests:
  1. Acceptance rate convergence with adaptive tuning (tolerant bounds 10–50%)
  2. Temperature monotonic decrease and minimum bound enforcement
  3. Backward compatibility: MCMC-off produces identical results with same seed
  4. Greedy vs probabilistic acceptance at different temperatures
  5. Revert correctness: rejected mutations preserve creature validity and diagnostics track decisions
  6. Mutation pipeline records acceptance decisions in diagnostics
  7. Full lifecycle: temperature cooling + diagnostics + adaptive tuning
  8. Weight/bias penalty proxy consistency with weight magnitude
