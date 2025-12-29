/**
 * FFI wrapper for the NEAT-AI-Discovery Rust library.
 *
 * This module provides a TypeScript interface to the Rust discovery recording
 * functionality via Deno's Foreign Function Interface (FFI).
 *
 * The Rust library must export a C-compatible function:
 * ```rust
 * #[no_mangle]
 * pub extern "C" fn record_discovery(input_json: *const c_char) -> *mut c_char
 * ```
 */

import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path/from-file-url";
import { join } from "@std/path/join";

const MAX_C_STRING_BYTES = 128 * 1024 * 1024; // 128 MiB guard for FFI strings

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
 * Structural candidate emitted by the Rust discovery engine: split an existing
 * synapse by inserting a new hidden neuron between the source and target.
 *
 * Note: This shape is intentionally aligned with the JSON payload emitted by
 * NEAT-AI-Discovery so TypeScript can consume it without lossy re-mapping.
 */
export interface RustSplitSynapseInsertNeuronCandidate {
  type: "split_synapse_insert_neuron";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  oldWeight: number;
  newNeuron: { uuid: string; type: "hidden"; squash: string; bias: number };
  newSynapses: Array<{
    from_uuid: string;
    to_uuid: string;
    weight: number;
    type?: string;
  }>;
  expectedCreatureScoreGain: number;
  comment?: string;
  fromNeuronIndex?: number;
  toNeuronIndex?: number;
  targetNeuronImpact?: number;
}

export type RustStructuralCandidate = RustSplitSynapseInsertNeuronCandidate;

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
   * Optional structural candidates emitted as tagged variants.
   * This allows NEAT-AI-Discovery to evolve additional candidate types without
   * breaking older TypeScript consumers.
   */
  structuralCandidates?: RustStructuralCandidate[];
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
  /**
   * Optional structural candidates emitted as tagged variants.
   * Supported variants are modelled by {@link RustStructuralCandidate}.
   */
  structuralCandidates?: RustStructuralCandidate[];
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
 * impact on the creature’s behaviour.
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
 */
export interface RustCheckGpuResult {
  success: boolean;
  gpuAvailable: boolean;
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
 * Converts a Creature to the Rust format expected by the discovery module.
 *
 * @param creature - The creature to convert
 * @returns The creature in Rust format
 */
export function creatureToRustFormat(creature: {
  neurons: Array<{
    uuid?: string;
    type: string;
    squash?: string;
    bias?: number;
  }>;
  synapses: Array<{
    fromUUID: string;
    toUUID: string;
    weight: number;
  }>;
  input: number;
  output: number;
}): RustRecordInput["creature"] {
  return {
    neurons: creature.neurons.map((n) => ({
      uuid: n.uuid || "unknown",
      type: n.type,
      squash: n.squash || "IDENTITY",
      bias: n.bias || 0,
    })),
    synapses: creature.synapses.map((s) => ({
      from_uuid: s.fromUUID,
      to_uuid: s.toUUID,
      weight: s.weight,
    })),
    input: creature.input,
    output: creature.output,
  };
}

export function computeRustRecordStats(
  input: RustRecordInput,
): RustRecordBatchStats {
  const sampleCount = input.training_data.length;
  const expectedNeuronCount =
    input.creature.neurons.filter((neuron) => neuron.type !== "input").length;

  let totalNeuronRecords = 0;
  let totalNeuronUuidBytes = 0;
  let totalErrorValues = 0;
  let maxErrorValuesPerNeuron = 0;
  let longestNeuronUuid = "";
  let longestNeuronUuidLength = 0;
  let inputLength: number | undefined;
  let outputLength: number | undefined;

  for (const record of input.training_data) {
    if (inputLength === undefined) {
      inputLength = record.input.length;
    }
    if (outputLength === undefined) {
      outputLength = record.output.length;
    }

    const neuronData = record.neuron_data ?? [];
    totalNeuronRecords += neuronData.length;

    for (const neuron of neuronData) {
      const uuid = typeof neuron.neuron_uuid === "string"
        ? neuron.neuron_uuid
        : "";
      const uuidLength = uuid.length;
      totalNeuronUuidBytes += uuidLength;

      if (uuidLength > longestNeuronUuidLength) {
        longestNeuronUuid = uuid;
        longestNeuronUuidLength = uuidLength;
      }

      const errors = neuron.errors ?? [];
      const errorCount = errors.length;
      totalErrorValues += errorCount;

      if (errorCount > maxErrorValuesPerNeuron) {
        maxErrorValuesPerNeuron = errorCount;
      }

      // VALIDATION: Check for unreasonable error counts
      // During backpropagation, each neuron records ONE error per sample
      // - Expected: sampleCount errors (one per sample)
      // - Multiplier of 2 provides buffer for edge cases
      // - Minimum threshold of 50 for small sample sizes
      const outputCount = outputLength ?? 1;
      const maxReasonableErrorsPerNeuron = Math.max(
        50,
        sampleCount * outputCount * 2,
      );

      if (errorCount > maxReasonableErrorsPerNeuron) {
        console.error(
          `❌ CRITICAL: Neuron ${uuid} has ${errorCount} errors, which exceeds reasonable maximum (${maxReasonableErrorsPerNeuron})!`,
        );
        console.error(
          `This indicates data corruption in the TypeScript logic.`,
        );
        console.error(
          `Samples: ${sampleCount}, Outputs: ${outputCount}, Max per neuron: ${maxReasonableErrorsPerNeuron}`,
        );
        console.error(`Errors array sample (first 10):`, errors.slice(0, 10));
        throw new Error(
          `Data corruption detected: neuron ${uuid} has ${errorCount} errors, ` +
            `which far exceeds reasonable maximum (${maxReasonableErrorsPerNeuron}). ` +
            `With ${sampleCount} samples and ${outputCount} outputs, this is impossible and indicates a bug in error recording.`,
        );
      }

      // LOG WARNING: Log if we're seeing unusually high error counts
      // This helps identify potential issues early
      const warningThreshold = Math.max(
        20,
        Math.ceil(sampleCount * outputCount * 1.5),
      );
      if (errorCount > warningThreshold) {
        console.warn(
          `⚠️  Neuron ${uuid} has ${errorCount} errors (expected ≤${warningThreshold} for ${sampleCount} samples × ${outputCount} outputs). ` +
            `During backprop, record() should be called once per sample per output. Multiple calls suggest a logic error.`,
        );
      }
    }
  }

  // VALIDATION: Total error values sanity check
  // Maximum possible: each neuron record could have up to max(50, sampleCount * outputCount * 3) errors
  // This is consistent with the per-neuron validation above.
  const outputCount = outputLength ?? 1;
  const maxReasonableErrorsPerRecord = Math.max(
    50,
    sampleCount * outputCount * 3,
  );
  const maxReasonableErrors = totalNeuronRecords * maxReasonableErrorsPerRecord;
  if (totalErrorValues > maxReasonableErrors) {
    console.error(
      `❌ CRITICAL: Total error values (${totalErrorValues}) exceeds reasonable maximum (${maxReasonableErrors})!`,
    );
    console.error(
      `With ${sampleCount} samples and ${expectedNeuronCount} neurons (${totalNeuronRecords} neuron records), this is impossible.`,
    );
    console.error(
      `Average errors per neuron record: ${
        (totalErrorValues / totalNeuronRecords).toFixed(2)
      }`,
    );
    console.error(
      `Max reasonable per record: ${maxReasonableErrorsPerRecord}`,
    );
    throw new Error(
      `Data corruption detected: ${totalErrorValues} total error values for ${totalNeuronRecords} neuron records ` +
        `(max ${maxReasonableErrors}). This suggests a critical bug in the error accumulation logic.`,
    );
  }

  return {
    sampleCount,
    expectedNeuronCount,
    totalNeuronRecords,
    totalNeuronUuidBytes,
    longestNeuronUuid: longestNeuronUuidLength > 0
      ? longestNeuronUuid
      : undefined,
    longestNeuronUuidLength,
    totalErrorValues,
    maxErrorValuesPerNeuron,
    inputLength,
    outputLength,
  };
}

/**
 * Platform-specific library file extension.
 */
function getLibraryExtension(): string {
  const platform = Deno.build.os;
  switch (platform) {
    case "darwin":
      return ".dylib";
    case "linux":
      return ".so";
    case "windows":
      return ".dll";
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function resolveLibraryCandidate(
  candidate: string,
  libName: string,
): string | null {
  try {
    const stat = Deno.statSync(candidate);
    if (stat.isFile) {
      return candidate;
    }

    if (stat.isDirectory) {
      const nestedPath = join(candidate, libName);
      const nestedStat = Deno.statSync(nestedPath);
      if (nestedStat.isFile) {
        return nestedPath;
      }
    }
  } catch {
    // Candidate path is not viable
  }

  return null;
}

function resolveOverridePath(libName: string): string | null {
  try {
    const override = Deno.env.get("NEAT_AI_DISCOVERY_LIB_PATH");
    if (!override || override.trim() === "") {
      return null;
    }

    return resolveLibraryCandidate(override, libName);
  } catch {
    // --allow-env not granted, ignore override
    return null;
  }
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

/**
 * Resolves the path to the Rust library.
 *
 * Checks in order:
 * 0. NEAT_AI_DISCOVERY_LIB_PATH override (file or directory)
 * 1. ~/.cargo/lib/ (from runlib.sh installation)
 * 2. ./target/release/ (local build artefacts)
 * 3. ../NEAT-AI-Discovery/target/release/ (for development)
 *
 * @returns The library path if found, null otherwise.
 */
export function findRustLibrary(): string | null {
  const libName = `libneat_ai_discovery${getLibraryExtension()}`;

  // Read override/home from environment (best effort).
  const overridePath = resolveOverridePath(libName) ?? undefined;

  let homeDir: string | undefined;
  try {
    homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || undefined;
  } catch {
    homeDir = undefined;
  }

  return findRustLibraryFromOptions({ overridePath, homeDir });
}

/**
 * Same resolution logic as `findRustLibrary()`, but driven by explicit inputs.
 *
 * This exists so tests can validate override precedence without mutating global
 * process environment variables (which are shared across parallel tests).
 */
export function findRustLibraryFromOptions(
  options: RustLibrarySearchOptions,
): string | null {
  const libName = `libneat_ai_discovery${getLibraryExtension()}`;

  const overridePath = options.overridePath?.trim();
  if (overridePath) {
    const overrideResolved = resolveLibraryCandidate(overridePath, libName);
    if (overrideResolved) {
      return overrideResolved;
    }
  }

  const homeDir = options.homeDir;
  if (homeDir) {
    const cargoLibPath = resolveLibraryCandidate(
      join(homeDir, ".cargo", "lib"),
      libName,
    );
    if (cargoLibPath) {
      return cargoLibPath;
    }
  }

  const cwd = options.cwd ?? Deno.cwd();
  const localTargetPath = resolveLibraryCandidate(
    join(cwd, "target", "release"),
    libName,
  );
  if (localTargetPath) {
    return localTargetPath;
  }

  const siblingDir = fromFileUrl(
    new URL(
      "../../../NEAT-AI-Discovery/target/release",
      import.meta.url,
    ),
  );
  const siblingTargetPath = resolveLibraryCandidate(siblingDir, libName);
  if (siblingTargetPath) {
    return siblingTargetPath;
  }

  return null;
}

/**
 * FFI symbols for the Rust library.
 *
 * The Rust function should be exported as:
 * ```rust
 * #[no_mangle]
 * pub extern "C" fn record_discovery(input_json: *const c_char) -> *mut c_char
 * ```
 */
type RustDiscoverySymbols = {
  "record_discovery": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "analyze_parallel": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "read_discovery_records_ffi": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "merge_discovery_parquet": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "rank_focus_neurons": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "check_gpu_available": {
    parameters: [];
    result: "pointer";
    nonblocking: false;
  };
  "get_library_version": {
    parameters: [];
    result: "pointer";
    nonblocking: false;
  };
  "free_discovery_result": {
    parameters: ["pointer"];
    result: "void";
    nonblocking: false;
  };
};

/**
 * Loaded Rust library instance.
 */
let rustLib: Deno.DynamicLibrary<RustDiscoverySymbols> | null = null;

/**
 * Closes the Rust library if it's loaded.
 * This is useful for test cleanup to avoid leak detection warnings.
 */
export function closeRustLibrary(): void {
  if (rustLib !== null) {
    rustLib.close();
    rustLib = null;
    rustGpuWarningEmitted = false;
    cachedDiscoveryVersion = null;
  }
  // Reset cached discovery state so it will be re-checked on next call
  rustDiscoveryEnabledState = "unknown";
}

/**
 * Loads the Rust discovery library.
 *
 * @returns true if the library was loaded successfully, false otherwise.
 */
export function loadRustLibrary(): boolean {
  if (rustLib !== null) {
    return true; // Already loaded
  }

  const libPath = findRustLibrary();
  if (!libPath) {
    return false;
  }

  try {
    // Ensure the process has FFI access to the discovery library before loading.
    if (typeof Deno.permissions?.querySync === "function") {
      const permission = Deno.permissions.querySync({
        name: "ffi",
        path: libPath,
      });
      if (permission.state !== "granted") {
        console.warn(
          `FFI permission denied for discovery library at ${libPath}. ` +
            "Run with --allow-ffi to enable Rust discovery.",
        );
        return false;
      }
    }

    const symbols: RustDiscoverySymbols = {
      "record_discovery": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "analyze_parallel": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "read_discovery_records_ffi": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "merge_discovery_parquet": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "rank_focus_neurons": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "check_gpu_available": {
        parameters: [],
        result: "pointer",
        nonblocking: false,
      },
      "get_library_version": {
        parameters: [],
        result: "pointer",
        nonblocking: false,
      },
      "free_discovery_result": {
        parameters: ["pointer"],
        result: "void",
        nonblocking: false,
      },
    };
    rustLib = Deno.dlopen(libPath, symbols);
    return true;
  } catch (error) {
    console.warn(
      `Failed to load Rust discovery library from ${libPath}:`,
      error,
    );
    return false;
  }
}

/**
 * Checks if the Rust library file exists without loading it.
 * This is useful for checking availability without causing memory leaks in tests.
 *
 * @returns true if the library file exists, false otherwise.
 */
export function rustLibraryExists(): boolean {
  return findRustLibrary() !== null;
}

let rustGpuWarningEmitted = false;

/** Cached NEAT-AI-Discovery library version (null = not yet fetched, undefined = fetch failed) */
let cachedDiscoveryVersion: string | null | undefined = null;

/**
 * Returns the NEAT-AI-Discovery library version.
 * The version is fetched once and cached for the lifetime of the library.
 *
 * @returns The version string (e.g., "0.1.151"), or undefined if unavailable.
 */
export function getDiscoveryVersion(): string | undefined {
  // Return cached result if already fetched
  if (cachedDiscoveryVersion !== null) {
    return cachedDiscoveryVersion ?? undefined;
  }

  if (!isRustLibraryAvailable()) {
    cachedDiscoveryVersion = undefined;
    return undefined;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    const resultPtr = rustLib.symbols["get_library_version"]();
    if (resultPtr === null) {
      console.warn(
        "[RustDiscovery] get_library_version returned null pointer.",
      );
      cachedDiscoveryVersion = undefined;
      return undefined;
    }

    const resultJson = readCString(resultPtr);
    rustLib.symbols["free_discovery_result"](resultPtr);

    const parsed = JSON.parse(resultJson) as RustGetVersionResult;
    if (parsed.success && parsed.version) {
      cachedDiscoveryVersion = parsed.version;
      return parsed.version;
    }

    console.warn(
      "[RustDiscovery] get_library_version failed:",
      parsed.error ?? "unknown error",
    );
    cachedDiscoveryVersion = undefined;
    return undefined;
  } catch (error) {
    console.warn("[RustDiscovery] get_library_version threw:", error);
    cachedDiscoveryVersion = undefined;
    return undefined;
  }
}

/**
 * Checks whether the loaded Rust discovery library reports a usable GPU.
 *
 * Returns false (and logs a warning once) when the probe fails or reports
 * that no GPU is available on this worker.
 */
export function isRustGpuAvailable(): boolean {
  if (!isRustLibraryAvailable()) {
    return false;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    const resultPtr = rustLib.symbols["check_gpu_available"]();
    if (resultPtr === null) {
      if (!rustGpuWarningEmitted) {
        rustGpuWarningEmitted = true;
        console.warn(
          "⚠️  Discovery GPU probe returned a null pointer. " +
            "Discovery will be disabled on this worker.",
        );
      }
      return false;
    }

    const resultJson = readCString(resultPtr);
    rustLib.symbols["free_discovery_result"](resultPtr);

    let parsed: RustCheckGpuResult;
    try {
      parsed = JSON.parse(resultJson) as RustCheckGpuResult;
    } catch {
      if (!rustGpuWarningEmitted) {
        rustGpuWarningEmitted = true;
        console.warn(
          "⚠️  Discovery GPU probe returned invalid JSON. " +
            "Discovery will be disabled on this worker.",
          resultJson,
        );
      }
      return false;
    }

    if (!parsed.success || !parsed.gpuAvailable) {
      if (!rustGpuWarningEmitted) {
        rustGpuWarningEmitted = true;
        const detail = parsed.error ?? "no usable GPU detected";
        console.warn(
          "🚧 Discovery disabled: Rust discovery library is loaded but no usable GPU " +
            `was reported for this worker (${detail}).`,
        );
      }
      return false;
    }

    return true;
  } catch (error) {
    if (!rustGpuWarningEmitted) {
      rustGpuWarningEmitted = true;
      console.warn(
        "⚠️  Discovery GPU probe threw an error. Discovery will be disabled " +
          "on this worker.",
        error,
      );
    }
    return false;
  }
}

/**
 * Checks if the Rust library is available (loaded or can be loaded).
 *
 * @returns true if available, false otherwise.
 */
export function isRustLibraryAvailable(): boolean {
  if (rustLib !== null) {
    return true;
  }
  return loadRustLibrary();
}

/**
 * Tristate for rust discovery availability.
 * - "unknown": Not yet checked
 * - true: Library is available AND GPU is available
 * - false: Library is not available OR GPU is not available
 */
type RustDiscoveryEnabledState = "unknown" | true | false;

let rustDiscoveryEnabledState: RustDiscoveryEnabledState = "unknown";

/**
 * Checks if the Rust discovery module is enabled and available.
 * Discovery is an extension that requires both the Rust library AND a GPU.
 * This function caches the result after the first check for low overhead.
 *
 * @returns true if both library and GPU are available, false otherwise.
 */
export function isRustDiscoveryEnabled(): boolean {
  // Return cached result if already checked
  if (rustDiscoveryEnabledState !== "unknown") {
    return rustDiscoveryEnabledState === true;
  }

  try {
    // First check: Library must be available
    if (!isRustLibraryAvailable()) {
      rustDiscoveryEnabledState = false;
      return false;
    }

    // Second check: GPU must be available (discovery requires GPU)
    const gpuAvailable = isRustGpuAvailable();
    rustDiscoveryEnabledState = gpuAvailable;
    return gpuAvailable;
  } catch {
    // FFI not allowed or library not available
    rustDiscoveryEnabledState = false;
    return false;
  }
}

const RUST_DISCOVERY_OPTIONAL_ENV = "NEAT_RUST_DISCOVERY_OPTIONAL";

/**
 * Returns true when discovery tests should be skipped (Rust library absent and
 * not explicitly required), false otherwise.
 */
export function shouldSkipRustDiscoveryTests(): boolean {
  const optional = (() => {
    try {
      const value = Deno.env.get(RUST_DISCOVERY_OPTIONAL_ENV);
      if (!value) {
        return false;
      }
      const normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true" ||
        normalized === "yes";
    } catch {
      return false;
    }
  })();

  if (!optional) {
    return false;
  }
  // Check for availability (library + GPU) for discovery tests
  return !isRustDiscoveryEnabled();
}

/**
 * Throws an explicit error when discovery is required but unavailable.
 * Provides specific guidance based on the failure mode:
 * - Library file not found
 * - FFI permission denied
 * - Library loading failed
 */
export function assertRustDiscoveryAvailable(): void {
  if (isRustDiscoveryEnabled()) {
    return; // All good
  }

  // Determine the specific failure reason
  const exists = rustLibraryExists();

  if (!exists) {
    throw new Error(
      "Rust discovery library not available: Library file not found. " +
        "Install it into ~/.cargo/lib or set NEAT_AI_DISCOVERY_LIB_PATH environment variable.",
    );
  }

  // Library exists but couldn't be loaded - check FFI permissions
  const libPath = findRustLibrary();
  if (libPath) {
    try {
      if (typeof Deno.permissions?.querySync === "function") {
        const permission = Deno.permissions.querySync({
          name: "ffi",
          path: libPath,
        });
        if (permission.state !== "granted") {
          throw new Error(
            "Rust discovery library not available: FFI permission denied. " +
              "Run with --allow-ffi flag to enable discovery.",
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("FFI permission")) {
        throw error;
      }
      // Permission check failed, but might be for other reasons
    }
  }

  // Library exists and FFI is allowed, but still not enabled
  throw new Error(
    "Rust discovery library not available: Library found but could not be loaded. " +
      "Rebuild the library via the NEAT-AI-Discovery project.",
  );
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
 * Reads discovery records from a Parquet file for a specific neuron.
 *
 * @param input - Input containing parquet file path and neuron UUID
 * @returns The read records or null if Rust library is not available
 */
export function readDiscoveryRecords(
  input: RustReadInput,
): RustReadResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    // Serialize input to JSON
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);

    // Allocate memory for input string (C string - null terminated)
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0; // Null terminator

    const inputPtr = Deno.UnsafePointer.of(inputBuffer);

    // Call Rust function
    const resultPtr = rustLib.symbols["read_discovery_records_ffi"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    // Read the result string from the pointer
    const resultJson = readCString(resultPtr);

    // Free the memory allocated by Rust
    rustLib.symbols["free_discovery_result"](resultPtr);

    // Parse the JSON result
    const result = JSON.parse(resultJson) as RustReadResult;

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function rankFocusNeurons(
  input: RustRankFocusInput,
): RustRankFocusResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0;

    const inputPtr = Deno.UnsafePointer.of(inputBuffer);
    const resultPtr = rustLib.symbols["rank_focus_neurons"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    const resultJson = readCString(resultPtr);
    rustLib.symbols["free_discovery_result"](resultPtr);

    const result = JSON.parse(resultJson) as RustRankFocusResult;
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

export function mergeDiscoveryParquet(
  input: RustMergeParquetInput,
): RustMergeParquetResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0;

    const inputPtr = Deno.UnsafePointer.of(inputBuffer);
    const resultPtr = rustLib.symbols["merge_discovery_parquet"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    const resultJson = readCString(resultPtr);
    rustLib.symbols["free_discovery_result"](resultPtr);

    const result = JSON.parse(resultJson) as RustMergeParquetResult;
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Helper to read a C string from a pointer.
 * Reads until null terminator.
 */
function readCString(ptr: Deno.PointerValue): string {
  if (ptr === null) {
    return "";
  }

  const view = new Deno.UnsafePointerView(ptr);
  let length = 0;

  // Find null terminator
  while (view.getUint8(length) !== 0) {
    length++;
    if (length >= MAX_C_STRING_BYTES) {
      throw new Error(
        `C string exceeded ${MAX_C_STRING_BYTES} bytes without null terminator`,
      );
    }
  }

  // Read the string
  const buffer = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = view.getUint8(i);
  }

  return new TextDecoder().decode(buffer);
}

/**
 * Records discovery data using the Rust module.
 *
 * NOTE: This requires the Rust library to export a C-compatible function:
 * ```rust
 * #[no_mangle]
 * pub extern "C" fn record_discovery(input_json: *const c_char) -> *mut c_char
 * ```
 * The function should allocate the result string and return a pointer to it.
 * The caller is responsible for freeing the memory (Rust should provide a free function).
 *
 * @param input - The discovery input data.
 * @returns The recording result, or null if the Rust library is unavailable.
 */
export function recordDiscovery(
  input: RustRecordInput,
): RustRecordResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  const stats = computeRustRecordStats(input);

  let inputJson: string | undefined;
  let inputBytes: Uint8Array | undefined;

  const buildFailure = (
    stage: RustRecordFailureStage,
    message: string,
    overrides: Partial<RustRecordErrorDetails> = {},
  ): RustRecordResult => {
    const details: RustRecordErrorDetails = {
      stage,
      stats,
      ...(overrides.stats ? { stats: overrides.stats } : {}),
      ...overrides,
    };

    if (
      details.inputJsonLength === undefined && typeof inputJson === "string"
    ) {
      details.inputJsonLength = inputJson.length;
    }

    if (
      details.inputBytesLength === undefined && inputBytes !== undefined
    ) {
      details.inputBytesLength = inputBytes.length;
    }

    return {
      success: false,
      error: message,
      errorDetails: details,
    };
  };

  try {
    inputJson = JSON.stringify(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure("stringify", message);
  }

  try {
    inputBytes = new TextEncoder().encode(inputJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure("encode", message, {
      inputJsonLength: inputJson.length,
    });
  }

  // Allocate memory for input string (C string - null terminated)
  const inputBuffer = new Uint8Array(inputBytes.length + 1);
  inputBuffer.set(inputBytes);
  inputBuffer[inputBytes.length] = 0; // Null terminator

  const inputPtr = Deno.UnsafePointer.of(inputBuffer);

  let resultPtr: Deno.PointerValue | null = null;
  let currentStage: RustRecordFailureStage = "ffi";

  try {
    resultPtr = rustLib.symbols["record_discovery"](inputPtr);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure(currentStage, message);
  }

  if (resultPtr === null) {
    return buildFailure("ffi", "Rust function returned null pointer");
  }

  try {
    const resultJson = readCString(resultPtr);
    currentStage = "parse";
    const parsed = JSON.parse(resultJson) as RustRecordResult;

    if (
      !parsed.success &&
      parsed.error?.includes("Invalid string length") &&
      !parsed.errorDetails
    ) {
      return {
        ...parsed,
        errorDetails: {
          stage: "rust",
          inputJsonLength: inputJson.length,
          inputBytesLength: inputBytes.length,
          stats,
        },
      };
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure(currentStage, message);
  } finally {
    rustLib.symbols["free_discovery_result"](resultPtr);
  }
}

export function analyzeParallel(
  input: RustParallelAnalysisInput,
): RustParallelAnalysisResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0;
    const inputPtr = Deno.UnsafePointer.of(inputBuffer);
    const resultPtr = rustLib.symbols["analyze_parallel"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    const resultJson = readCString(resultPtr);
    rustLib.symbols["free_discovery_result"](resultPtr);
    const result = JSON.parse(resultJson) as RustParallelAnalysisResult;
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
