## Summary

Add MCMC acceptance rate tracking and adaptive temperature tuning. Closes #2201.

Creates `MCMCDiagnostics` to track per-generation Metropolis-Hastings acceptance
statistics (proposed/accepted/rejected counts and acceptance rate) with a
rolling window for smoothed rates. Implements adaptive temperature tuning that
adjusts temperature toward the target acceptance rate (~23.4%, Roberts et al.
1997):

- Acceptance rate too high: decrease temperature (be more selective)
- Acceptance rate too low: increase temperature (accept more)
- Within tolerance: no adjustment

Temperature is clamped between `minTemperature` and `initialTemperature`.
Diagnostics are no-ops when `mcmc.enabled` is `false`.

Verbose logging reports per-generation MCMC statistics including temperature,
acceptance rate (current and smoothed), and proposed/accepted/rejected counts.

## Evidence

- 16 new unit tests cover acceptance rate calculation, rolling window smoothing,
  adaptive temperature increase/decrease, temperature clamping, disabled no-op
  behaviour, and convergence over repeated generations
- All 5414 existing tests continue to pass
- `./quality.sh` passes cleanly

## Test Plan

- `test/NEAT/MCMCDiagnostics.ts` - 16 tests:
  - Acceptance rate with no decisions returns 0
  - Acceptance rate tracks accepted/rejected decisions correctly
  - 100% and 0% acceptance rate edge cases
  - `getGenerationStats()` returns correct counts
  - Rolling window smooths across generations
  - Rolling window respects window size and drops old generations
  - Adaptive temperature decreases when acceptance rate too high
  - Adaptive temperature increases when acceptance rate too low
  - Temperature unchanged when acceptance rate within tolerance
  - Temperature clamped at `minTemperature` and `initialTemperature`
  - No-op when `mcmc.enabled` is `false`
  - `finaliseGeneration()` resets current generation counts
  - Repeated adaptive tuning converges temperature
