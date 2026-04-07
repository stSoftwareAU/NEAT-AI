## Summary

Add MCMC temperature configuration module (`MCMCConfig.ts`) following the
established config pattern. This provides the temperature and cooling schedule
parameters required by the Metropolis-Hastings acceptance criterion to be
implemented in subsequent issues. Closes #2199.

Part of #2197.

## Changes

- **New file `src/config/MCMCConfig.ts`**: `MCMCConfig` interface with optional
  fields (`enabled`, `initialTemperature`, `minTemperature`, `coolingRate`,
  `targetAcceptanceRate`), `RequiredMCMCConfig` type alias, and
  `DEFAULT_MCMC_CONFIG` constant. Disabled by default (non-breaking).
- **`NeatArguments.ts`**: Added `mcmc: RequiredMCMCConfig` field.
- **`NeatOptions.ts`**: Added `mcmc` to both `Omit` lists and partial override
  blocks (with `CoerceNumeric<>` for CLI string coercion).
- **`NeatConfigParsers.ts`**: Added `parseMcmc()` using `parseNumber()` with
  `minExclusive`/`maxExclusive` constraints.
- **`NeatConfig.ts`**: Wired `parseMcmc()` into `createNeatConfig()`.
- **`NeatConfigValidation.ts`**: Added cross-field validation ensuring
  `minTemperature <= initialTemperature`.
- **`ParseOptions.ts`**: Added `maxExclusive` support to `NumberConstraints` and
  `parseNumber()` for strict upper-bound validation (0 < coolingRate < 1).

## Evidence

All 5375 tests pass including 15 new MCMC config tests. `./quality.sh` passes
cleanly (lint, format, type-check, all tests).

## Test Plan

- Added `test/config/MCMCConfig.ts` with 15 tests covering:
  - Default config values applied when not specified
  - `enabled` defaults to `false` (non-breaking)
  - Custom values override defaults
  - Partial overrides merge with defaults
  - CLI string values coerced to numbers
  - `initialTemperature > 0` validation (zero and negative rejected)
  - `minTemperature > 0` validation (zero and negative rejected)
  - `coolingRate` must be in `(0, 1)` (zero, one, and >1 rejected)
  - `targetAcceptanceRate` must be in `(0, 1)` (zero and one rejected)
  - Cross-field: `minTemperature <= initialTemperature`
