## Summary

Replace generic `throw new Error(...)` calls with appropriate typed error classes across the discovery, ErrorGuidedStructuralEvolution, reconstruct, and predictiveCoding modules. Closes #1696.

### Changes by module

**discovery/** (4 files):
- `DiscoveryRunner.ts`: `DiscoveryError` for library unavailable, `ConfigurationError` for invalid sample rate and timeout settings
- `FailureCacheKey.ts`: `TopologyError` for missing synapse details (bug indicator)
- `HoldoutValidator.ts`: Removed dead code — `Costs.find()` already throws `ValidationError` for unknown cost functions
- `DiscoveryReplayRunner.ts`: `ConfigurationError` for missing `discoverySuccessCacheDir`

**ErrorGuidedStructuralEvolution/** (6 files):
- `NeuronImpact.ts`: `TopologyError` for impact ordering violation
- `RustFlushDiagnostics.ts`: `DiscoveryError` for data corruption detection
- `DiscoverDataLoading.ts`: `DiscoveryError` for missing Parquet files and FFI failures, `TopologyError` for invalid neuron identifiers
- `DiscoverStructureRecording.ts`: `DiscoveryError` for missing Rust library during chunk merging
- `DiscoverSquashAnalysis.ts`: `TopologyError` for undefined activations/values
- `RustDiscoveryLibrary.ts`: `DiscoveryError` for C string overflow and unsupported platforms

**reconstruct/** (1 file):
- `validateDNA.ts`: All 16 `throw new Error(...)` replaced with `CrisprError` using `"INVALID_DNA"` code

**predictiveCoding/** (2 files):
- `PredictionErrorGuidedMutation.ts`: `TopologyError` for empty candidates
- `PredictiveCodingTrainer.ts`: `ValidationError` for no samples processed

## Evidence

This is a backend-only change with no UI impact. All 4405 tests pass including 28 new typed error tests.

## Test Plan

- `test/reconstruct/ValidateDNATypedErrors.ts` — 17 tests covering all CrisprError paths in validateDNA
- `test/discovery/DiscoveryTypedErrors.ts` — 7 tests for DiscoveryRunner, buildCacheKey, HoldoutValidator, and DiscoveryReplayRunner error types
- `test/discovery/EGSETypedErrors.ts` — 3 tests for calculateSquashError and findCandidateSquash TopologyError paths
- `test/predictiveCoding/PredictiveCodingTypedErrors.ts` — 1 test for selectWeightedIndex TopologyError
