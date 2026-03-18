/**
 * Type definitions for the Rust discovery FFI interface.
 *
 * All interfaces and types used to communicate with the NEAT-AI-Discovery
 * Rust library via Deno's Foreign Function Interface.
 */

/**
 * Result of recording discovery data via Rust module.
 */
export interface RustRecordBatchStats {
  sampleCount: number;
  expectedNeuronCount: number;
  totalNeuronRecords: number;
  totalNeuronUuidBytes: number;
  longestNeuronUuid?: string;
  longestNeuronUuidLength: number;
  totalErrorValues: number;
  maxErrorValuesPerNeuron: number;
  inputLength?: number;
  outputLength?: number;
}

export type RustRecordFailureStage =
  | "stringify"
  | "encode"
  | "ffi"
  | "parse"
  | "rust";

/**
 * Captures the failure stage and payload sizing information when a Rust
 * recording attempt does not succeed, allowing downstream callers to triage the
 * issue without repeating discovery.
 */
export interface RustRecordErrorDetails {
  stage: RustRecordFailureStage;
  inputJsonLength?: number;
  inputBytesLength?: number;
  stats: RustRecordBatchStats;
}

/**
 * Mirrors the Rust FFI response emitted by `record_discovery`, including the
 * success flag, any produced artefact paths, and enriched error metadata.
 */
export interface RustRecordResult {
  success: boolean;
  "temp_dir"?: string;
  file?: string;
  error?: string;
  errorDetails?: RustRecordErrorDetails;
}

/**
 * Aggregated neuron statistics emitted by the Rust analyser describing error
 * and activation behaviour across the sampled training set.
 */
export interface NeuronStatsJson {
  meanError: number;
  errorVariance: number;
  meanActivation: number;
  activationVariance: number;
  errorSpikeCount: number;
  activationSpikeCount: number;
  activationMin: number;
  activationMax: number;
}

/**
 * Represents a synapse candidate proposed by the Rust analyser, including
 * improvement statistics gathered from sampled observations.
 *
 * As of Rust v0.2.0, this interface uses creature-level metrics:
 * - targetNeuronImpact: 0.0-1.0, where output neurons = 1.0
 * - expectedCreatureErrorReduction: creature-level error reduction
 * - expectedCreatureScoreGain: creature-level score improvement
 *
 * These values are already scaled by the neuron's impact on creature output,
 * so TypeScript should NOT apply additional scaling (e.g., getNeuronShare()).
 */
export interface RustCandidateSynapse {
  fromNeuronUuid: string;
  toNeuronUuid: string;
  weight: number;
  targetNeuronImpact: number;
  expectedCreatureErrorReduction: number;
  expectedCreatureScoreGain: number;
  improvedCount: number;
  totalCount: number;
  /**
   * Optional diagnostic comment emitted by the Rust discovery engine.
   * This must not affect ranking/selection logic.
   */
  comment?: string;
  targetNeuronStats?: NeuronStatsJson;
}

/**
 * Represents a neuron candidate flagged by the Rust analyser together with the
 * statistics that justify its expected impact.
 *
 * As of Rust v0.2.0, this interface uses creature-level metrics:
 * - targetNeuronImpact: 0.0-1.0, where output neurons = 1.0
 * - expectedCreatureErrorReduction: creature-level error reduction
 * - expectedCreatureScoreGain: creature-level score improvement
 *
 * These values are already scaled by the neuron's impact on creature output,
 * so TypeScript should NOT apply additional scaling (e.g., getNeuronShare()).
 */
export interface RustCandidateNeuron {
  sourceNeuronUuid: string;
  targetNeuronUuid: string;
  incomingWeight: number;
  outgoingWeight: number;
  squash: string;
  bias: number;
  targetNeuronImpact: number;
  expectedCreatureErrorReduction: number;
  expectedCreatureScoreGain: number;
  improvedCount: number;
  totalCount: number;
  /**
   * Optional diagnostic comment emitted by the Rust discovery engine.
   * This must not affect ranking/selection logic.
   */
  comment?: string;
  targetNeuronStats?: NeuronStatsJson;
}

/**
 * Coordinated structural operation emitted by Rust.
 */
export type RustCoordinatedStructuralOperation =
  | RustCoordinatedRemoveSynapseOperation
  | RustCoordinatedAddSynapseOperation;

export interface RustCoordinatedRemoveSynapseOperation {
  type: "removeSynapse";
  fromNeuronUuid: string;
  toNeuronUuid: string;
}

export interface RustCoordinatedAddSynapseOperation {
  type: "addSynapse";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  weight: number;
}

/**
 * Ordered grouped structural candidate emitted by Rust.
 */
export interface RustCoordinatedStructuralCandidate {
  type: "coordinated_structural";
  operations: RustCoordinatedStructuralOperation[];
  expectedCreatureScoreGain: number;
  comment?: string;
}

export type RustStructuralCandidate = never;

/**
 * Encapsulates the synapse-centric branch of a parallel analysis run, including
 * whether the GPU path was used and any helpful or harmful synapse candidates.
 */
export interface RustAnalyzeSynapsesResult {
  success: boolean;
  gpuUsed?: boolean;
  /**
   * Optional candidate metadata emitted by NEAT-AI-Discovery (when available).
   *
   * Note (29-Dec-2025): Older library versions will omit this field.
   */
  metadata?: RustCandidateMetadata;
  helpfulSynapses?: RustCandidateSynapse[];
  harmfulSynapses?: RustCandidateSynapse[];
  diagnostics?: RustSynapseDiagnostic[];
  error?: string;
}

/**
 * Encapsulates the neuron-centric branch of a parallel analysis run, reporting
 * candidate improvements and any diagnostic warnings.
 */
export interface RustAnalyzeNeuronsResult {
  success: boolean;
  gpuUsed?: boolean;
  /**
   * Optional candidate metadata emitted by NEAT-AI-Discovery (when available).
   *
   * Note (29-Dec-2025): Older library versions will omit this field.
   */
  metadata?: RustCandidateMetadata;
  helpfulNeurons?: RustCandidateNeuron[];
  /**
   * Coordinated structural candidates emitted by Rust.
   *
   * Note: This field is carried on the combined result produced by
   * `analyze_parallel` and is plumbed through via `convertParallelAnalysisResult()`.
   */
  coordinatedStructuralCandidates?: RustCoordinatedStructuralCandidate[];
  diagnostics?: RustNeuronDiagnostic[];
  error?: string;
}

/**
 * Combined response for a parallel analysis invocation, returning whichever of
 * the synapse or neuron branches executed successfully.
 */
export interface RustAnalyzeAllResult {
  success: boolean;
  synapse?: RustAnalyzeSynapsesResult;
  neuron?: RustAnalyzeNeuronsResult;
  error?: string;
}

/**
 * Payload forwarded to the Rust `analyze_parallel` entry point describing the
 * artefacts, focus neurons, thresholds, and GPU requirements for the run.
 */
export interface RustParallelAnalysisInput {
  parquetFile: string;
  creature: RustRecordInput["creature"];
  focusNeurons: string[];
  maxSynapseCandidates?: number;
  maxNeuronCandidates?: number;
  requireGpu?: boolean;
  analysisDeadlineMs?: number;
  /**
   * Maps each focus neuron UUID to its impact on the creature's output.
   * As of Rust v0.2.0, the Rust library calculates creature-level metrics
   * internally using this data. Output neurons have impact = 1.0,
   * while hidden neurons have smaller impacts based on their distance
   * from outputs.
   *
   * @deprecated This field is now primarily for logging/debugging.
   * The Rust library v0.2.0 handles impact scaling internally.
   */
  focusNeuronErrorShares?: Record<string, number>;
}

/**
 * Response emitted from `analyze_parallel`, containing modality-specific
 * candidate lists, diagnostics, and GPU usage indicators.
 */
export interface RustParallelAnalysisResult {
  success: boolean;
  helpfulSynapses?: RustCandidateSynapse[];
  harmfulSynapses?: RustCandidateSynapse[];
  /**
   * Optional metadata describing synapse candidate discovery.
   * - candidatesFound: how many candidates were considered/found before truncation
   * - candidatesReturned: how many candidates were returned in `helpfulSynapses`
   */
  synapseMetadata?: RustCandidateMetadata;
  synapseDiagnostics?: RustSynapseDiagnostic[];
  synapseGpuUsed?: boolean;
  helpfulNeurons?: RustCandidateNeuron[];
  /**
   * Optional metadata describing neuron candidate discovery.
   * - candidatesFound: how many candidates were considered/found before truncation
   * - candidatesReturned: how many candidates were returned in `helpfulNeurons`
   */
  neuronMetadata?: RustCandidateMetadata;
  /** Ordered grouped structural candidates (epistatic groups). */
  coordinatedStructuralCandidates?: RustCoordinatedStructuralCandidate[];
  neuronDiagnostics?: RustNeuronDiagnostic[];
  neuronGpuUsed?: boolean;
  error?: string;
}

/**
 * Input specification for `rank_focus_neurons`, nominating the relevant
 * discovery dataset and optional ranking limits.
 */
export interface RustRankFocusInput {
  parquetFile: string;
  creature: RustRecordInput["creature"];
  maxResults?: number;
}

/**
 * Summarises a ranked neuron, pairing the UUID with total error and estimated
 * impact on the creature's behaviour.
 */
export interface RustFocusNeuronScore {
  neuronUuid: string;
  totalError: number;
  impact: number;
}

/**
 * A neuron flagged for potential removal due to high error but very low impact.
 * These neurons consume compute but don't meaningfully contribute to outputs.
 *
 * Criteria:
 * - Impact < 0.01 (less than 1% contribution to outputs)
 * - Error > average error across all neurons
 */
export interface RustRemovalCandidate {
  neuronUuid: string;
  totalError: number;
  impact: number;
  reason: string; // e.g., "High error (5.0000) but very low impact (0.000100) - far from outputs"
  /**
   * Mean activation of the removed neuron across the full discovery dataset.
   * Used for bias compensation during ablation so downstream neurons preserve
   * their average pre-activation value.
   */
  meanActivation?: number;
  /**
   * Optional diagnostic comment emitted by the Rust discovery engine.
   * This must not affect ranking/selection logic.
   */
  comment?: string;
}

/**
 * Response structure for focus neuron ranking runs, including winning scores,
 * removal candidates, and execution diagnostics.
 */
export interface RustRankFocusResult {
  success: boolean;
  neurons?: RustFocusNeuronScore[];
  removalCandidates?: RustRemovalCandidate[];
  maxOutputError?: number;
  processedNeurons?: number;
  totalNeurons?: number;
  durationMs?: number;
  error?: string;
}

/**
 * Reports the outcome of the Rust GPU availability probe invoked during
 * discovery setup.
 *
 * When the Rust library supports it, the probe also reports which wgpu
 * backend was selected (Metal, Vulkan, DX12, OpenGL) and the adapter name,
 * enabling cross-platform GPU diagnostics.
 */
export interface RustCheckGpuResult {
  success: boolean;
  gpuAvailable: boolean;
  /** wgpu backend name, e.g. "metal", "vulkan", "dx12", "gl". */
  backend?: string;
  /** wgpu backend name (legacy alias for `backend`). */
  backendName?: string;
  /** GPU adapter/device name, e.g. "Apple M1 Pro". */
  adapterName?: string;
  error?: string;
}

/**
 * Reports the NEAT-AI-Discovery library version compiled into the binary.
 */
export interface RustGetVersionResult {
  success: boolean;
  version: string;
  error?: string;
}

export type RustSynapseDiagnosticReason =
  | "no_eligible_sources"
  | "no_diagnostics"
  | "no_samples"
  | "zero_improvement"
  | "below_threshold";

/**
 * Optional supporting context for a synapse diagnostic, offering counts and
 * thresholds that explain why a candidate did not pass eligibility checks.
 */
export interface RustSynapseDiagnosticDetail {
  sourceNeuronUuid?: string;
  sampleCount?: number;
  sourceRecordCount?: number;
  improvedCount?: number;
  worsenedCount?: number;
  expectedCreatureScoreGain?: number;
  threshold?: number;
  suggestedWeight?: number;
}

/**
 * Summarises diagnostic outcomes for a target neuron when analysing synapse
 * candidates, clarifying why no proposal was returned.
 */
export interface RustSynapseDiagnostic {
  targetNeuronUuid: string;
  reason: RustSynapseDiagnosticReason;
  evaluatedCandidates: number;
  candidatesWithSamples: number;
  targetRecordCount: number;
  detail?: RustSynapseDiagnosticDetail;
}

/**
 * Optional metadata emitted by NEAT-AI-Discovery describing candidate selection.
 *
 * This is used for logging/telemetry only and must not influence ranking logic.
 */
export interface RustCandidateMetadata {
  candidatesFound: number;
  candidatesReturned: number;
}

export type RustNeuronDiagnosticReason =
  | "no_eligible_sources"
  | "no_diagnostics"
  | "no_samples"
  | "not_enough_activations"
  | "weight_degenerate"
  | "below_threshold";

/**
 * Optional supporting context for neuron diagnostics, including orientation,
 * sample counts, and improvement metrics that informed the outcome.
 */
export interface RustNeuronDiagnosticDetail {
  sourceNeuronUuid?: string;
  orientation?: string;
  sampleCount?: number;
  improvedCount?: number;
  worsenedCount?: number;
  expectedCreatureScoreGain?: number;
  threshold?: number;
  outgoingWeight?: number;
}

/**
 * Summarises diagnostic outcomes for neuron-level analysis, indicating why the
 * Rust engine could not supply a candidate neuron.
 */
export interface RustNeuronDiagnostic {
  targetNeuronUuid: string;
  reason: RustNeuronDiagnosticReason;
  evaluatedSources: number;
  sourcesWithSamples: number;
  targetRecordCount: number;
  detail?: RustNeuronDiagnosticDetail;
}

/**
 * Input structure for Rust record_discovery function.
 * Matches the RecordDiscoveryInput struct in Rust.
 *
 * Note: The Rust module currently has TODOs for creature activation.
 * For now, we'll pass pre-computed neuron data along with training data.
 * The Rust module will use the pre-computed data if available.
 */
export interface RustRecordInput {
  creature: {
    neurons: Array<{
      uuid: string;
      type: string;
      squash: string;
      bias: number;
    }>;
    synapses: Array<{
      from_uuid: string;
      to_uuid: string;
      weight: number;
    }>;
    input: number;
    output: number;
  };
  "training_data": Array<{
    input: number[];
    output: number[];
    // Pre-computed neuron data (activations and errors)
    // This will be used by Rust instead of activating the creature
    neuron_data?: Array<{
      neuron_uuid: string;
      activation: number;
      value?: number;
      errors: number[]; // Array of error values
    }>;
  }>;
  "temp_dir": string;
  "binary_file_path"?: string;
  "record_indices"?: number[];
  "timeout_seconds"?: number;
}

/**
 * Input for reading discovery records from Parquet.
 */
export interface RustReadInput {
  "parquet_file": string;
  "neuron_uuid": string;
}

/**
 * Result of reading discovery records from Parquet.
 */
export interface RustReadResult {
  success: boolean;
  records?: Array<{
    obs_index: number;
    neuron_uuid: string;
    value: number | null;
    activation: number;
    errors: number[];
  }>;
  error?: string;
}

/**
 * Defines the output artefact and source shards that should be merged into a
 * consolidated discovery Parquet file.
 */
export interface RustMergeParquetInput {
  outputFile: string;
  inputFiles: string[];
}

/**
 * Reports whether the Parquet merge succeeded and where the merged file was
 * written, or describes any error returned by Rust.
 */
export interface RustMergeParquetResult {
  success: boolean;
  outputFile?: string;
  error?: string;
}

export type RustLibrarySearchOptions = Readonly<{
  /**
   * Optional override path (file or directory) that should win over all defaults.
   * This mirrors the `NEAT_AI_DISCOVERY_LIB_PATH` environment variable.
   */
  overridePath?: string;
  /**
   * Home directory used for resolving `~/.cargo/lib`.
   * When omitted, the HOME/USERPROFILE environment variables are used (if available).
   */
  homeDir?: string;
  /**
   * Current working directory used for resolving local `./target/release`.
   * Defaults to `Deno.cwd()` when omitted.
   */
  cwd?: string;
}>;
