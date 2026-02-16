## Summary

Introduce typed `ConfigurationError` and `TopologyError` classes following the
existing error class pattern (`DiscoveryError`, `WasmError`, `ActivationError`).
Migrated all generic `throw new Error()` calls in the 5 highest-impact files to
use the appropriate typed error class, enabling consumers to catch errors by
type and inspect structured `reason` fields.

Closes #1479.

### Changes

- **New error classes** in `src/errors/`:
  - `ConfigurationError` with reasons: `INVALID_TYPE`, `OUT_OF_RANGE`,
    `NOT_INTEGER`, `NOT_FINITE`, `CROSS_FIELD_VALIDATION`
  - `TopologyError` with reasons: `INVALID_NEURON_TYPE`, `INVALID_SQUASH`,
    `MISSING_SQUASH`, `INVALID_CONNECTION`, `INVALID_STATE`, `DUPLICATE_UUID`,
    `MISSING_NEURON`, `SORT_FAILURE`, `EXCESSIVE_ERRORS`

- **Migrated files**:
  - `src/config/ParseOptions.ts` — 11 errors → `ConfigurationError`
  - `src/config/NeatConfig.ts` — 9 errors → `ConfigurationError`
  - `src/architecture/Neuron.ts` — 11 errors → `TopologyError` (5 "Not
    implemented" placeholders left as-is)
  - `src/architecture/Offspring.ts` — 16 errors → `TopologyError`
  - `src/architecture/CreatureValidate.ts` — 12 errors → `TopologyError`
    (existing `ValidationError` calls preserved)

## Evidence

This is a backend/CLI change with no visual output. All 3848 existing tests
pass, plus 33 new tests verify the error classes and their integration.

## Test Plan

- `test/errors/ConfigurationError.ts` — 9 tests covering all reason types,
  instanceof checks, and selective catching
- `test/errors/TopologyError.ts` — 13 tests covering all reason types,
  instanceof checks, and selective catching
- `test/errors/ConfigurationErrorIntegration.ts` — 6 tests verifying
  `parseNumber` and `parseDiscoverySampleRate` throw `ConfigurationError`
- `test/errors/TopologyErrorIntegration.ts` — 5 tests verifying `Neuron`
  constructor, validate, exportJSON, and mutate throw `TopologyError`
- All 3848 existing tests continue to pass (backward-compatible since new
  classes extend `Error`)
