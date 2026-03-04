## Summary

Remove dead code that is not used internally within NEAT-AI or externally by GRQ
or NEAT-AI-Discovery. Closes #1690.

### Dead source files removed (7 files)

These source files were never imported by any production code:

- `src/NEAT/AdaptiveMutationRate.ts` - Stability-based mutation adaptation
  (Issue #1307), never integrated
- `src/architecture/CompactSynapseStore.ts` - Struct-of-arrays synapse storage
  (Issue #1662), never integrated
- `src/architecture/TrainingMetrics.ts` - Training metrics collector, never
  integrated
- `src/breed/EnsembleDiversityScoring.ts` - Ensemble diversity scoring (Issue
  #1310), never integrated
- `src/breed/StabilityAwareSelection.ts` - Stability-aware parent selection
  (Issue #1307), never integrated
- `src/utils/validateCreatureExport.ts` - Creature export schema validator,
  never used in production
- `src/wasm/WasmPredictiveCoding.ts` - WASM predictive coding engine interface
  (Issue #1560), never integrated

### Dead test/bench files removed (8 files)

Tests and benchmarks that only exercised the dead source files above:

- `test/mutate/AdaptiveMutationRate.ts`
- `test/architecture/CompactSynapseStore.ts`
- `test/optimization/TrainingMetrics.ts`
- `test/breed/EnsembleDiversityScoring.ts`
- `test/breed/StabilityAwareSelection.ts`
- `test/schema/SnapshotSchema.ts`
- `test/wasm/WasmPredictiveCoding.ts`
- `bench/StructOfArraysSynapses.ts`

### Unused public API re-exports removed from mod.ts

Cross-referenced against GRQ and NEAT-AI-Discovery usage. These re-exports were
not used by either consumer:

- `applyNeuronChanges`, `safeWriteText`, `safeWriteTextSync`
- `WorkerProcessor as IntelligentDesignWorkerProcessor`
- Types: `ApplyTacitKnowledgeOptions`, `ImproveSquashOptions`,
  `ImproveSquashResult`, `RequestData as IntelligentDesignRequestData`,
  `ResponseData as IntelligentDesignResponseData`, `TacitKnowledgeResult`,
  `WorkerInterface as IntelligentDesignWorkerInterface`

Note: The underlying code remains available internally; only the unused public
re-exports were removed.

### Minor cleanups

- Made `bumpToFourIfForwardOnlyConfirmed()` and `shouldEnforceForwardOnly()` in
  `src/discovery/CandidateApplication.ts` non-exported (only used within the
  same file)
- Removed stale comment referencing deleted `validateCreatureExport` in
  `CreatureInterfaces.ts`
- Updated `test/intelligentDesign/Exports.ts` to match the reduced public API

## Evidence

This is a code-removal change with no UI impact. All 4331 existing tests pass
after the removal, confirming no production code depended on the deleted files.

## Test Plan

- All 4331 existing tests pass (`./quality.sh` clean)
- No new tests needed (this is a removal-only change)
- Verified no internal imports reference the deleted files
- Verified GRQ and NEAT-AI-Discovery repos do not use any of the removed exports
