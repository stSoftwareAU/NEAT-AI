## Summary

Refactored DiscoverStructure.ts (5,413 lines) by extracting types, static
application methods, and Rust flush diagnostics into three focused modules. The
main file was reduced by ~29% (to 3,854 lines) while maintaining full backward
compatibility through re-exports. Closes #1395.

## Changes

### New Modules

- **DiscoverStructureTypes.ts** (297 lines) - All shared interfaces and type
  definitions (DiscoverRecord, CandidateSynapse, CandidateNeuron,
  CandidateSquash, CandidateHarmfulNeuron, RustFlushMetrics, etc.)

- **DiscoveryApplication.ts** (1,181 lines) - Static methods for applying
  discovery results to creatures: validateAndFixIfNeeded, recordDiscoveryIssue,
  removeSynapse, addHelpfulSynapses, addHelpfulNeurons, changeSquash,
  removeHarmfulNeuron, removeLowImpactNeuron, resetRemovalDiagnostics,
  getRemovalSameUUIDCount

- **RustFlushDiagnostics.ts** (319 lines) - Rust flush validation and metrics:
  truncateForLogValue, createRustFlushAggregation, observeRustTrainingRecord,
  finalizeRustFlushDiagnostics, computeRustFlushMetrics

### Modified Files

- **DiscoverStructure.ts** (5,413 -> 3,854 lines) - Imports from extracted
  modules, delegates static methods to standalone functions, re-exports all
  types for backward compatibility. Removed unused imports.

### New Tests

- **test/ErrorGuidedStructuralEvolution/RustFlushDiagnostics.ts** (251 lines)
  - 15 tests covering truncation, aggregation, sample observation, mismatch
    detection, missing UUID detection, non-finite value detection, error count
    validation, and batch metric computation

- **test/ErrorGuidedStructuralEvolution/DiscoveryApplication.ts** (338 lines)
  - 16 tests covering validateAndFixIfNeeded, removeSynapse, addHelpfulSynapses,
    addHelpfulNeurons, changeSquash, removeHarmfulNeuron, removal diagnostics,
    and recordDiscoveryIssue

## Evidence

- All 2,584 tests pass (2,553 existing + 31 new)
- `deno check` type-checks cleanly
- `deno lint` passes with no errors
- `deno fmt` produces no changes
- `./quality.sh` passes completely

## Test Plan

- [x] All existing tests continue to pass (backward compatibility verified)
- [x] New unit tests exercise extracted functions directly
- [x] Type-checking confirms no broken imports across 57+ consumer files
- [x] quality.sh passes (fmt, lint, check, test)
