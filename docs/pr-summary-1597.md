# PR Summary: Refactor: Split large ErrorGuidedStructuralEvolution source files (#1597)

## Overview

Split 6 large source files in the `ErrorGuidedStructuralEvolution/` directory
into focused modules, each under ~500 lines. This is a pure refactor with no
functional changes. All 4,372 existing tests pass without modification.

## Files Split

### DiscoverStructure.ts (1,822 lines -> 4 files)

Used an inheritance chain pattern
(`Base -> Recording -> Analysis -> DiscoverStructure`) with `protected` fields:

- **DiscoverStructureBase.ts** (~536 lines): Fields, constructor, lifecycle,
  helpers, output error cache, data loading, neuron impact delegates
- **DiscoverStructureRecording.ts** (~542 lines): `record()`, chunk management,
  flush methods, Rust Parquet recording
- **DiscoverStructureAnalysis.ts** (~619 lines): Focus selection, Rust analysis
  cache, all `analyze*` methods, squash/harmful neuron analysis
- **DiscoverStructure.ts** (~211 lines): Slim facade with static application
  delegates, type re-exports

### DiscoverDirectory.ts (1,626 lines -> 5 files)

Extracted standalone functions with context interfaces for parameter passing:

- **DiscoveryPerformance.ts** (~253 lines): `DiscoveryPerformanceStats`,
  `formatDiscoveryPerformanceSummary`, `shouldLogDiscovery`
- **DataRecorderRecording.ts** (~424 lines): `processDiscoveryFile`,
  `runRecordingPhase` with `FileProcessingContext`/`RecordingPhaseContext`
- **DataRecorderAnalysis.ts** (~638 lines): `runAnalysisLoop` with
  `AnalysisLoopContext`, candidate logging helpers
- **DataRecorder.ts** (~508 lines): `DataRecorder` class, `recordDirectory`
  entry point
- **DiscoverDirectory.ts** (~17 lines): Barrel re-export

### RustDiscovery.ts (1,626 lines -> 4 files + barrel)

- **RustDiscoveryTypes.ts**: Type definitions, interfaces, FFI symbol
  declarations
- **RustDiscoveryInput.ts**: `creatureToRustFormat`, input preparation
- **RustDiscoveryLibrary.ts**: Library loading, lifecycle, permission checks
- **RustDiscoveryOperations.ts**: `recordDiscovery`, `analyzeParallel`,
  `mergeDiscoveryParquet`, `readDiscoveryRecords`
- **RustDiscovery.ts**: Barrel re-export

### DiscoveryApplication.ts (1,180 lines -> 4 files + barrel)

- **DiscoveryValidation.ts**: `validateAndFixIfNeeded`, `recordDiscoveryIssue`,
  diagnostics
- **DiscoverySynapseOps.ts**: `removeSynapse`, `addHelpfulSynapses`
- **DiscoveryNeuronAddition.ts**: `addHelpfulNeurons`, `changeSquash`
- **DiscoveryNeuronRemoval.ts**: `removeHarmfulNeuron`, `removeLowImpactNeuron`,
  removal diagnostics
- **DiscoveryApplication.ts**: Barrel re-export

### FocusSelection.ts (734 lines -> 2 files + barrel)

- **FocusSelectionRanking.ts**: Rust-backed ranking, neuron ranking logic
- **FocusSelectionWeighting.ts**: Weighted selection, error-based neuron picking
- **FocusSelection.ts**: Barrel re-export

### DiscoverLogging.ts (544 lines -> 2 files + barrel)

- **DiscoverLoggingCore.ts**: Core logging functions (`logDiscovery`,
  `logHelpfulSynapse`, etc.)
- **DiscoverDiagnosticFormatting.ts**: Diagnostic formatting for Rust
  synapse/neuron diagnostics
- **DiscoverLogging.ts**: Barrel re-export

## Design Decisions

1. **Barrel re-exports**: Original filenames become thin barrel re-exports,
   maintaining all existing import paths.
2. **Inheritance chain for DiscoverStructure**: Used class inheritance with
   `protected` fields instead of standalone functions, since the class has 30+
   fields that would require excessive context object passing.
3. **Context interfaces for DataRecorder**: Used
   `FileProcessingContext`/`RecordingPhaseContext`/`AnalysisLoopContext`
   interfaces to pass DataRecorder state to standalone functions.
4. **Slightly over 500 lines**: A few files are slightly over the ~500 line
   target (e.g. DataRecorderAnalysis at 638, DiscoverStructureAnalysis at 619)
   where further splitting would reduce cohesion.

## Verification

- `./quality.sh` passes: formatting, linting, type-checking, and all 4,372 tests
- No test modifications required
- No functional changes
