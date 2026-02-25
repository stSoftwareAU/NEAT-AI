## Summary

Add runtime validation for NeatOptions configuration to catch invalid values at
config creation time rather than deep in the training loop. Closes #1614.

Changes:
- **mutationRate upper bound**: Added `max: 1` constraint so values like `1.5`
  are rejected immediately with a clear `ConfigurationError`
- **elitism < populationSize**: Added cross-field validation ensuring elitism
  cannot equal or exceed the population size, which would leave no room for
  evolved offspring
- **17 new tests** covering invalid mutationRate, populationSize, elitism
  cross-field violations, discovery timeout bounds, WASM cache bounds, and
  string coercion errors

## Evidence

This is a backend configuration validation change with no UI component.
All 4222 tests pass including the 17 new validation tests.

## Test Plan

- `test/config/NeatOptionsRuntimeValidation.ts` — 17 tests covering:
  - mutationRate > 1 throws ConfigurationError
  - Negative mutationRate throws ConfigurationError
  - mutationRate 0 throws ConfigurationError (below exclusive minimum)
  - mutationRate 1 is valid (upper bound)
  - mutationRate 0.5 is valid
  - populationSize 0 throws ConfigurationError
  - Negative populationSize throws ConfigurationError
  - populationSize 1 throws ConfigurationError (minimum is 2)
  - elitism >= populationSize throws ConfigurationError
  - elitism > populationSize throws ConfigurationError
  - elitism < populationSize is valid
  - discoveryAnalysisTimeoutMinutes below minimum throws
  - discoveryAnalysisTimeoutMinutes above maximum throws
  - wasmCache maxCachedActivations 0 throws
  - wasmCache compilationCacheSize 0 throws
  - mutationRate as invalid string throws ConfigurationError
  - populationSize as non-numeric string throws
