## Summary

Add WASM cache configuration to `NeatOptions` following the established Config
Pattern. Closes #1566.

Previously, the WASM LRU cache caps (`WasmCreatureActivationLRU` default 512,
`WasmCompilationCache` default 100) were set only via imperative function calls
with no integration into the standard config lifecycle. This caused mismatches —
e.g. a fixed activation cache of 32 with a large population leads to constant
eviction/recompilation churn.

Key changes:

- Created `WasmCacheConfig` with `maxCachedActivations` and
  `compilationCacheSize` fields
- Default `maxCachedActivations` scales with `populationSize * 2` rather than a
  fixed number
- Config is applied in `evolveDir()` before training starts
- Follows the established Config Pattern (config type, required type, defaults,
  NeatArguments, NeatOptions, NeatConfig parsing)

## Evidence

This is a backend/config change with no visual output. Verified by:

- 14 new unit tests covering defaults, overrides, CLI string coercion,
  validation, and population-scaling behaviour
- All 4242 existing tests continue to pass

## Test Plan

- Added `test/config/WasmCacheConfig.ts` with 14 tests:
  - Default `maxCachedActivations` scales with `populationSize`
  - Default `compilationCacheSize` matches static default
  - Custom values override defaults
  - Partial overrides merge with defaults
  - String values coerced from CLI
  - Validation: `maxCachedActivations` must be >= 1, integer
  - Validation: `compilationCacheSize` must be >= 1, integer
  - Negative values rejected
  - Large population scaling
  - Explicit activation cache overrides population scaling
  - Default values are sensible
