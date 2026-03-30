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
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryTypes.ts";

// Input conversion
export {
  computeRustRecordStats,
  creatureToRustFormat,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryInput.ts";

// Library management and availability
export {
  assertRustDiscoveryAvailable,
  closeRustLibrary,
  findRustLibrary,
  findRustLibraryFromOptions,
  getDiscoveryVersion,
  getGpuBackendInfo,
  getRustGpuBackend,
  isRustDiscoveryEnabled,
  isRustGpuAvailable,
  isRustLibraryAvailable,
  loadRustLibrary,
  rustLibraryExists,
  shouldSkipRustDiscoveryTests,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryLibrary.ts";

export type { GpuBackendInfo } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryLibrary.ts";

// FFI operations
export {
  analyzeParallel,
  mergeDiscoveryParquet,
  rankFocusNeurons,
  readDiscoveryRecords,
  recordDiscovery,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryOperations.ts";
