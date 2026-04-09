## Summary

Add MCMC acceptance rate tracking and adaptive temperature tuning. Closes #2201.

Implements per-generation acceptance rate diagnostics with a rolling-window
smoothed rate, and adaptive temperature tuning that adjusts MCMC temperature
toward the target acceptance rate (~23.4%, Roberts et al. 1997). When the
smoothed acceptance rate drifts outside a configurable tolerance band, the
temperature is nudged up (if too few mutations accepted) or down (if too many
accepted). Complements PlateauDetector: plateau detection adjusts _how much_
mutation happens, while MCMC temperature adjusts _which mutations stick_.

Makes `adjustmentRate` and `toleranceRate` configurable via `MCMCConfig`
(instead of hardcoded constants) following the established config pattern. Adds
`reset()` to `MCMCDiagnostics` and `setTemperature()` to `MCMCState`.

### Changes

- **`src/config/MCMCConfig.ts`**: Added `adjustmentRate` (default 0.02) and
  `toleranceRate` (default 0.05) fields for adaptive tuning configuration.
- **`src/config/NeatConfigParsers.ts`**: Added parsing for `adjustmentRate` and
  `toleranceRate` with `minExclusive: 0, maxExclusive: 1` constraints.
- **`src/NEAT/MCMCDiagnostics.ts`**: Updated to read `adjustmentRate` and
  `toleranceRate` from config instead of hardcoded constants. Added `reset()`.
- **`src/NEAT/MCMCState.ts`**: Added `setTemperature()` method for direct
  temperature control by adaptive tuning or external callers.

## Evidence

All 5422 tests pass. `./quality.sh --skip-discovery --skip-wasm` passes cleanly.

## Test Plan

- **`test/NEAT/MCMCDiagnostics.ts`** (1 new test):
  - `reset()` clears all diagnostics state
- **`test/NEAT/MCMCState.ts`** (1 new test):
  - `setTemperature()` updates temperature and subsequent cooling applies
    correctly
- **`test/config/MCMCConfig.ts`** (6 new tests):
  - Defaults include `adjustmentRate` and `toleranceRate`
  - `adjustmentRate` validation (must be > 0 and < 1)
  - `toleranceRate` validation (must be > 0 and < 1)
  - Custom values override defaults
  - String coercion from CLI
