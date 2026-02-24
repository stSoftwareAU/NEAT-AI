/**
 * Barrel re-export for the Rust discovery FFI interface.
 *
 * This module re-exports all Rust discovery types, functions, and utilities
 * from their focused sub-modules to maintain backwards compatibility.
 */

// Types
export type {
  NeuronStatsJson,
  RustAnalyzeAllResult,
  RustAnalyzeNeuronsResult,
  RustAnalyzeSynapsesResult,
  RustCandidateMetadata,
  RustCandidateNeuron,
  RustCandidateSynapse,
  RustCheckGpuResult,
  RustCoordinatedAddSynapseOperation,
  RustCoordinatedRemoveSynapseOperation,
  RustCoordinatedStructuralCandidate,
  RustCoordinatedStructuralOperation,
  RustFocusNeuronScore,
  RustGetVersionResult,
  RustLibrarySearchOptions,
  RustMergeParquetInput,
  RustMergeParquetResult,
  RustNeuronDiagnostic,
  RustNeuronDiagnosticDetail,
  RustNeuronDiagnosticReason,
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
  RustRankFocusInput,
  RustRankFocusResult,
  RustReadInput,
  RustReadResult,
  RustRecordBatchStats,
  RustRecordErrorDetails,
  RustRecordFailureStage,
  RustRecordInput,
  RustRecordResult,
  RustRemovalCandidate,
  RustStructuralCandidate,
  RustSynapseDiagnostic,
  RustSynapseDiagnosticDetail,
  RustSynapseDiagnosticReason,
} from "./RustDiscoveryTypes.ts";

// Input conversion
export {
  computeRustRecordStats,
  creatureToRustFormat,
} from "./RustDiscoveryInput.ts";

// Library management and availability
export {
  assertRustDiscoveryAvailable,
  closeRustLibrary,
  findRustLibrary,
  findRustLibraryFromOptions,
  getDiscoveryVersion,
  isRustDiscoveryEnabled,
  isRustGpuAvailable,
  isRustLibraryAvailable,
  loadRustLibrary,
  rustLibraryExists,
  shouldSkipRustDiscoveryTests,
} from "./RustDiscoveryLibrary.ts";

// FFI operations
export {
  analyzeParallel,
  mergeDiscoveryParquet,
  rankFocusNeurons,
  readDiscoveryRecords,
  recordDiscovery,
} from "./RustDiscoveryOperations.ts";
