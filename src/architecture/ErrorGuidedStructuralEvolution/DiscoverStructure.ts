import { assert } from "@std/assert";
import type { Creature } from "../../Creature.ts";
import { isWasmActivationAvailable } from "../../wasm/mod.ts";
import { MSE } from "../../costs/MSE.ts";
import type { ActivationInterface } from "../../methods/activations/ActivationInterface.ts";
import { Activations } from "../../methods/activations/Activations.ts";
import { CreatureErrorImpactEstimator } from "../../discovery/NeuronErrorImpactEstimator.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import { fromRustRemovalCandidate } from "./DiscoverResult.ts";
import type {
  CoordinatedStructuralCandidate,
} from "./CoordinatedStructuralCandidate.ts";
import {
  analyzeParallel,
  creatureToRustFormat,
  isRustDiscoveryEnabled,
  isRustLibraryAvailable,
  mergeDiscoveryParquet,
  rankFocusNeurons,
  readDiscoveryRecords,
  recordDiscovery,
  type RustAnalyzeAllResult,
  type RustAnalyzeNeuronsResult,
  type RustAnalyzeSynapsesResult,
  type RustCandidateNeuron,
  type RustCandidateSynapse,
  type RustNeuronDiagnostic,
  type RustNeuronDiagnosticDetail,
  type RustParallelAnalysisInput,
  type RustParallelAnalysisResult,
  type RustRecordBatchStats,
  type RustRecordInput,
  type RustSynapseDiagnostic,
  type RustSynapseDiagnosticDetail,
} from "./RustDiscovery.ts";
import {
  DEFAULT_RUST_FLUSH_BYTES,
  DEFAULT_RUST_FLUSH_RECORDS,
} from "./constants.ts";
import { emptyDirSync, ensureDirSync } from "@std/fs";
import { dirname } from "@std/path";
import type {
  BinaryRecordIndices,
  CandidateAnalysisBundle,
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
  DiscoverRecord,
  DiscoverStructureOptions,
  FocusNeuronCandidate,
  FocusSelectionAnalysis,
  FocusSelectionMode,
  FocusSelectionSummary,
  LowImpactNeuron,
  NeuronErrorInfo,
  NeuronImpactInfo,
  NeuronScanStats,
  RustFlushAggregation,
  RustFlushDiagnostics,
} from "./DiscoverStructureTypes.ts";
import {
  addHelpfulNeurons as addHelpfulNeuronsImpl,
  addHelpfulSynapses as addHelpfulSynapsesImpl,
  changeSquash as changeSquashImpl,
  getRemovalSameUUIDCount as getRemovalSameUUIDCountImpl,
  recordDiscoveryIssue as recordDiscoveryIssueImpl,
  removeHarmfulNeuron as removeHarmfulNeuronImpl,
  removeLowImpactNeuron as removeLowImpactNeuronImpl,
  removeSynapse as removeSynapseImpl,
  resetRemovalDiagnostics as resetRemovalDiagnosticsImpl,
  validateAndFixIfNeeded as validateAndFixIfNeededImpl,
} from "./DiscoveryApplication.ts";
import {
  computeRustFlushMetrics as computeRustFlushMetricsImpl,
  createRustFlushAggregation as createRustFlushAggregationImpl,
  finalizeRustFlushDiagnostics as finalizeRustFlushDiagnosticsImpl,
  observeRustTrainingRecord as observeRustTrainingRecordImpl,
  truncateForLogValue as truncateForLogValueImpl,
} from "./RustFlushDiagnostics.ts";
import { getLogger } from "../../utils/Logger.ts";

export { DEFAULT_RUST_FLUSH_RECORDS } from "./constants.ts";
export { DEFAULT_RUST_FLUSH_BYTES } from "./constants.ts";

// Re-export all types from DiscoverStructureTypes for backward compatibility
export type {
  BinaryRecordIndices,
  CandidateAnalysisBundle,
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
  DiscoverRecord,
  DiscoverStructureOptions,
  FocusNeuronCandidate,
  FocusSelectionAnalysis,
  FocusSelectionMode,
  FocusSelectionSummary,
  FocusSelectionSummaryEntry,
  LowImpactNeuron,
  NeuronErrorInfo,
  NeuronImpactInfo,
  NeuronScanStats,
  NeuronStats,
  RustFlushAggregation,
  RustFlushDiagnostics,
  RustFlushMetrics,
} from "./DiscoverStructureTypes.ts";

export interface DiscoverStructureDeps {
  isRustDiscoveryEnabled: typeof isRustDiscoveryEnabled;
  isRustLibraryAvailable: typeof isRustLibraryAvailable;
  recordDiscovery: typeof recordDiscovery;
  mergeDiscoveryParquet: typeof mergeDiscoveryParquet;
  analyzeParallel: typeof analyzeParallel;
  readDiscoveryRecords: typeof readDiscoveryRecords;
  rankFocusNeurons?: typeof rankFocusNeurons;
}

const DEFAULT_DISCOVER_STRUCTURE_DEPS: DiscoverStructureDeps = {
  isRustDiscoveryEnabled,
  isRustLibraryAvailable,
  recordDiscovery,
  mergeDiscoveryParquet,
  analyzeParallel,
  readDiscoveryRecords,
  rankFocusNeurons,
};

const OUTPUT_ERROR_CACHE_TTL_MS = 30_000;

/**
 * Implements Error-Driven Structural Discovery, analysing neuron activations and errors
 * to identify beneficial structural changes (new synapses, neuron removal, activation changes).
 *
 * Designed for continuous incremental improvement through repeated runs across multiple machines.
 * Typical improvements are 0.5-3% per iteration, compounding over time.
 *
 * @see docs/DISCOVERY_GUIDE.md for complete workflow documentation
 */
export class DiscoverStructure {
  private creature: Creature;
  private tempDir: string;
  private textDecoder: TextDecoder;
  private timeoutTS: number;
  private loggingEnabled = false;
  private discoveryID: string;

  private initialized = false;
  private recorded = false;

  private selectedIndices: BinaryRecordIndices = {};
  private indicesFilePath: string;

  // Rust recording: accumulate data for Rust Parquet writing (Rust is required)
  private rustAccumulatedData: DataRecordInterface[] = [];
  private rustAccumulatedNeuronData: Array<Map<string, DiscoverRecord>> = [];
  private rustAccumulatedEstimatedBytes = 0;
  private rustEstimatedBytesPerSample = 0;
  private rustBinaryFilePath: string | null = null;
  private rustBinaryFilePaths: Set<string> = new Set(); // Track all binary file paths
  private usingRustDualWrite = false;
  private parquetFilePath: string | null = null;
  private rustFlushRecords: number;
  private rustFlushBytesThreshold: number;
  private rustChunkFiles: string[] = [];
  private rustChunkCounter = 0;
  private syntheticBinaryMode = false;
  private deps: DiscoverStructureDeps;
  private forcedFocusNeurons: string[] | null = null;
  private forcedFocusIndex = 0;
  private neuronImpactEstimator?: CreatureErrorImpactEstimator;
  private neuronIndexMap?: Map<string, number>;
  private lastFocusSelection?: FocusSelectionSummary;
  private cachedMaxOutputError?: { value: number; computedAt: number } =
    undefined;
  private lastNeuronScanStats?: NeuronScanStats;
  private analysisDeadlineMs?: number;
  /** Low-impact neurons flagged for removal by Rust focus ranking. */
  private cachedRemovalCandidates?:
    import("./DiscoverResult.ts").RemovalCandidate[];
  private combinedRustAnalysis?: {
    key: string;
    includeSynapse: boolean;
    includeNeuron: boolean;
    result: RustAnalyzeAllResult;
  };
  /**
   * Lightweight fallback cache for focus selection.
   *
   * In rare cases the Rust focus ranking can return an empty list even when
   * discovery recording succeeded (typically under very tight CI timing or
   * when the Rust analyser declines to emit focus scores).
   *
   * We keep a per-neuron running total of absolute error observed during
   * `record()` so `listViableNeurons()` can still return a non-empty list.
   *
   * Note: this is not a replacement for Rust analysis; it only prevents the
   * selection pipeline from collapsing to "no candidates" due to an empty
   * ranking response.
   */
  private recordedNeuronTotalAbsError = new Map<string, number>();
  private analysisTimeoutGuardEnabled = true;
  private disableCleanup = false;
  private skipRecordPhase = false;
  constructor(
    creature: Creature,
    timeoutSeconds: number,
    rustFlushRecords: number = DEFAULT_RUST_FLUSH_RECORDS,
    deps: Partial<DiscoverStructureDeps> = {},
    options: DiscoverStructureOptions = {},
  ) {
    this.creature = creature;
    assert(creature.uuid, "Creature must have a UUID to discover structure.");
    // In `deno test`, creature UUIDs are often deterministic across tests.
    // When tests run concurrently, using a shared `${baseDir}/${creature.uuid}`
    // directory can cause cross-test interference (eg. one test clearing the
    // directory while another is still recording/analysing).
    //
    // To keep tests reliable, default to an isolated base directory unless the
    // caller explicitly provides `options.baseDirectory`.
    let baseDir = options.baseDirectory ?? ".discovery";
    try {
      const env = (key: string) => Deno.env.get(key)?.trim().toLowerCase();
      const denoTest = env("DENO_TEST") === "1" || env("DENO_TEST") === "true";
      const suiteDeterministic =
        env("NEAT_AI_DISCOVERY_DETERMINISTIC") === "1" ||
        env("NEAT_AI_DISCOVERY_DETERMINISTIC") === "true";

      if (
        options.baseDirectory === undefined && (denoTest || suiteDeterministic)
      ) {
        baseDir = `.discovery/test-${Deno.pid}-${
          crypto.randomUUID().slice(0, 8)
        }`;
      }
    } catch {
      // If env access is restricted, fall back to the default base directory.
    }
    this.tempDir = `${baseDir}/${creature.uuid}`;
    this.indicesFilePath = `${this.tempDir}/selected_indices.json`;
    this.textDecoder = new TextDecoder();
    this.discoveryID = creature.uuid;
    assert(
      timeoutSeconds > 0,
      `Timeout seconds must be greater than 0, was: ${timeoutSeconds}`,
    );
    assert(
      timeoutSeconds <= 60 * 60,
      `Timeout seconds must be less than 1 hour: was ${timeoutSeconds}`,
    );
    this.timeoutTS = Date.now() + timeoutSeconds * 1000;
    this.rustFlushRecords = Math.max(1, rustFlushRecords);
    this.rustFlushBytesThreshold = Math.max(
      1,
      options.rustFlushBytesThreshold ?? DEFAULT_RUST_FLUSH_BYTES,
    );
    this.deps = { ...DEFAULT_DISCOVER_STRUCTURE_DEPS, ...deps };
    this.disableCleanup = options.disableCleanup ?? false;
    this.skipRecordPhase = options.skipRecordPhase ?? false;

    // Rough estimate per sample for JSON payload sizing:
    // - ~200 bytes per neuron record (uuid + activation + errors metadata)
    // - ~4 bytes per float for input/output values
    const nonInputNeuronCount =
      creature.neurons.filter((n) => n.type !== "input")
        .length;
    this.rustEstimatedBytesPerSample = (200 * nonInputNeuronCount) +
      (4 * (creature.input + creature.output));

    // Only clear the directory if we're not skipping the record phase
    // When skipping, just ensure it exists (for tests that don't use existing data)
    if (this.skipRecordPhase) {
      ensureDirSync(this.tempDir);
    } else {
      emptyDirSync(this.tempDir);
    }
  }

  public configureLogging(options: {
    verbose?: boolean;
    discoveryID?: string;
  }): void {
    this.loggingEnabled = Boolean(options?.verbose);
    if (options?.discoveryID) {
      this.discoveryID = options.discoveryID;
    }
  }

  /**
   * Returns the path to the temporary discovery directory.
   * Useful for debugging when examining discovery files.
   */
  public getTempDir(): string {
    return this.tempDir;
  }

  /**
   * Checks if the record phase should be skipped because parquet files already exist.
   * Returns true if skipRecordPhase is enabled and valid parquet data exists.
   */
  public shouldSkipRecording(): boolean {
    if (!this.skipRecordPhase) {
      return false;
    }

    // Check if the merged parquet file exists
    const mergedParquetPath = `${this.tempDir}/discovery_data.parquet`;
    try {
      const stat = Deno.statSync(mergedParquetPath);
      if (stat.isFile && stat.size > 0) {
        if (this.loggingEnabled) {
          getLogger().info(
            `[Discovery ${this.discoveryID}] Skipping record phase - using existing parquet file: ${mergedParquetPath}`,
          );
        }
        this.parquetFilePath = mergedParquetPath;
        return true;
      }
    } catch {
      // File doesn't exist, proceed with recording
    }

    // Check if chunk files exist (unmerged data)
    const chunksDir = `${this.tempDir}/chunks`;
    try {
      const stat = Deno.statSync(chunksDir);
      if (stat.isDirectory) {
        const entries = Array.from(Deno.readDirSync(chunksDir));
        const parquetChunks = entries.filter((e) =>
          e.isFile && e.name.endsWith(".parquet")
        );
        if (parquetChunks.length > 0) {
          if (this.loggingEnabled) {
            getLogger().info(
              `[Discovery ${this.discoveryID}] Skipping record phase - found ${parquetChunks.length} existing chunk files in: ${chunksDir}`,
            );
          }
          // Populate rustChunkFiles for later merging
          this.rustChunkFiles = parquetChunks.map((e) =>
            `${chunksDir}/${e.name}`
          );
          return true;
        }
      }
    } catch {
      // Chunks directory doesn't exist, proceed with recording
    }

    if (this.loggingEnabled) {
      getLogger().info(
        `[Discovery ${this.discoveryID}] No existing parquet files found - proceeding with recording`,
      );
    }
    return false;
  }

  private isSelectableNeuronType(neuronType: string | undefined): boolean {
    return neuronType !== "input" && neuronType !== "constant";
  }

  private isSelectableNeuron(neuron: { type: string }): boolean {
    return this.isSelectableNeuronType(neuron.type);
  }

  private async measureMaxOutputError(): Promise<number> {
    if (
      !this.recorded &&
      (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled())
    ) {
      return 0;
    }

    const outputs = this.creature.neurons.filter((neuron) =>
      neuron.type === "output"
    );
    const promises = outputs.map(async (outputNeuron) => {
      let neuronMax = 0;
      try {
        const records = await this.loadNeuronRecords(
          `${this.tempDir}/${outputNeuron.uuid}`,
        );
        records.forEach((record) => {
          record.errors.forEach((err) => {
            if (Number.isFinite(err)) {
              neuronMax = Math.max(neuronMax, Math.abs(err));
            }
          });
        });
      } catch (error) {
        if (this.loggingEnabled) {
          this.log(
            "debug",
            `Failed to read output neuron errors for ${outputNeuron.uuid}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return neuronMax;
    });
    const results = await Promise.all(promises);
    return results.reduce((max, value) => Math.max(max, value), 0);
  }

  private async getMaxOutputError(): Promise<number> {
    const now = Date.now();
    if (
      this.cachedMaxOutputError &&
      now - this.cachedMaxOutputError.computedAt < OUTPUT_ERROR_CACHE_TTL_MS
    ) {
      return this.cachedMaxOutputError.value;
    }
    const measured = await this.measureMaxOutputError();
    this.cachedMaxOutputError = { value: measured, computedAt: now };
    return measured;
  }

  /**
   * Extends the timeout to allow analysis phase to complete.
   * Call this after recording phase completes to ensure analysis gets adequate time.
   * @param analysisTimeSeconds - Number of seconds to allocate for analysis phase
   */
  public extendTimeoutForAnalysis(analysisTimeSeconds: number): void {
    assert(
      analysisTimeSeconds > 0,
      `Analysis time must be greater than 0, was: ${analysisTimeSeconds}`,
    );
    this.timeoutTS = Date.now() + analysisTimeSeconds * 1000;
    this.analysisDeadlineMs = this.timeoutTS;
    this.analysisTimeoutGuardEnabled = false;
  }

  public setForcedFocusNeurons(neuronUUIDs: readonly string[]): void {
    const usable = Array.isArray(neuronUUIDs)
      ? neuronUUIDs
        .map((uuid) => typeof uuid === "string" ? uuid.trim() : "")
        .filter((uuid) => uuid.length > 0)
      : [];

    if (usable.length === 0) {
      this.forcedFocusNeurons = null;
      if (this.loggingEnabled) {
        this.log(
          "warn",
          "Received empty discoveryFocusNeuronUUIDs override; falling back to weighted selection.",
        );
      }
      return;
    }

    const validNeuronUUIDs = new Set(
      this.creature.neurons
        .filter((neuron) => this.isSelectableNeuron(neuron))
        .map((neuron) => neuron.uuid),
    );

    const filtered = usable.filter((uuid) => {
      const valid = validNeuronUUIDs.has(uuid);
      if (!valid && this.loggingEnabled) {
        this.log(
          "warn",
          `Forced focus neuron '${uuid}' is not a selectable hidden/output neuron and will be ignored.`,
        );
      }
      return valid;
    });

    if (filtered.length === 0) {
      this.forcedFocusNeurons = null;
      if (this.loggingEnabled) {
        this.log(
          "warn",
          "No valid forced focus neurons remained after filtering; reverting to weighted selection.",
        );
      }
      return;
    }

    this.forcedFocusNeurons = Array.from(new Set(filtered));
    this.forcedFocusIndex = 0;
    if (this.loggingEnabled) {
      this.log(
        "info",
        `Applying forced discovery focus neurons: ${
          this.forcedFocusNeurons.join(", ")
        }`,
      );
    }
  }

  /**
   * Initializes the discovery process.
   * Requires the NEAT-AI-Discovery Rust library to be available.
   */
  public initialize(neuronPromisesMap: Map<string, Promise<void>>) {
    assert(!this.initialized, "Already initialized");
    this.initialized = true;

    // Rust discovery is required.
    assert(
      this.deps.isRustDiscoveryEnabled(),
      "Rust discovery must be enabled (library present + permissions granted).",
    );
    this.usingRustDualWrite = true;

    // Set up promise placeholders for all neurons (Rust handles file creation)
    this.creature.neurons.forEach((neuron) => {
      neuronPromisesMap.set(neuron.uuid, Promise.resolve());
    });

    // Initialize the indices file as an empty JSON object
    try {
      Deno.writeTextFileSync(this.indicesFilePath, "{}", { createNew: true });
    } catch (e) {
      // Tests (and some discovery flows) can legitimately re-enter initialise for the same
      // temp directory knowably. If the file already exists, keep it.
      if (e instanceof Deno.errors.AlreadyExists) {
        return;
      }
      throw e;
    }
  }

  /**
   * Cleans up temporary resources and resets the internal state after discovery.
   * Also closes the Rust library to avoid leak detection warnings in tests.
   */
  public async cleanUp() {
    assert(this.initialized, "Not initialized");
    this.initialized = false;
    this.recorded = false;
    this.creature.dispose();
    this.discoveries = [];
    this.neuronDiscoveries = [];
    this.cachedMaxOutputError = undefined;
    this.lastNeuronScanStats = undefined;
    this.combinedRustAnalysis = undefined;

    // Clear selectedIndices to help GC
    this.selectedIndices = {};

    // Clear references to help GC
    // @ts-ignore - clearing to help GC
    this.creature = null;
    // @ts-ignore - clearing to help GC
    this.discoveries = null;
    // @ts-ignore - clearing to help GC
    this.neuronDiscoveries = null;

    // Close Rust library if it was loaded (for test cleanup)
    try {
      const { closeRustLibrary } = await import("./RustDiscovery.ts");
      closeRustLibrary();
    } catch {
      // Ignore errors during cleanup
    }

    // Skip directory removal if cleanup is disabled (for debugging)
    if (this.disableCleanup) {
      if (this.loggingEnabled) {
        getLogger().info(
          `[Discovery ${this.discoveryID}] Cleanup disabled - preserving temporary files at: ${this.tempDir}`,
        );
      }
      return;
    }

    try {
      await Deno.remove(this.tempDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors to prevent crashes
      getLogger().warn(`Failed to cleanup discovery temp dir: ${error}`);
    }
  }

  /**
   * Records neuron activations and errors across the provided training data.
   * Requires the NEAT-AI-Discovery Rust library - discovery fails gracefully if not available.
   * Accumulates data for batch processing via Rust module (Parquet format).
   */
  public record(
    trainingData: DataRecordInterface[],
    _neuronPromisesMap: Map<string, Promise<void>>,
    binaryFilePath?: string,
    recordIndices?: number[],
    options?: Readonly<{
      /**
       * Allow a small "grace" batch after the timeout has technically expired.
       *
       * This is primarily used by the directory recorder, which may have
       * buffered samples but miss the final submit window by a few milliseconds
       * under heavy load. Keeping this opt-in preserves strict timeout semantics
       * for callers that rely on record() being a hard cut-off.
       */
      allowGraceAfterTimeout?: boolean;
    }>,
  ): boolean {
    assert(this.initialized, "Not initialized");
    const timedOut = Date.now() > this.timeoutTS;
    this.recorded = true;
    this.cachedMaxOutputError = undefined;

    assert(
      this.usingRustDualWrite,
      "Discovery recording requires Rust discovery to be enabled.",
    );

    // Under tight record deadlines (eg. 60ms timeout tests), we can end up with
    // buffered samples in the caller, but miss the final submit window by a few
    // milliseconds under load. If we refuse all record() calls after the timeout,
    // we can produce *zero* Parquet artefacts, which makes discovery debugging
    // and CI regressions very hard to reason about.
    //
    // So: if we have not recorded anything yet, accept a small grace batch even
    // when the timeout is already expired.
    let effectiveTrainingData = trainingData;
    let effectiveRecordIndices = recordIndices;
    if (timedOut) {
      const hasAnyRecordedSoFar = this.rustChunkFiles.length > 0 ||
        this.rustAccumulatedData.length > 0;
      if (hasAnyRecordedSoFar) {
        this.log(
          "warn",
          "Discovery recording timeout reached; skipping remaining samples.",
        );
        return false;
      }

      if (!options?.allowGraceAfterTimeout) {
        this.log(
          "warn",
          "Discovery recording timeout reached; skipping remaining samples.",
        );
        return false;
      }

      // Grace capture: keep this small to avoid blowing the deadline further.
      const MAX_GRACE_SAMPLES = 64;
      const take = Math.min(effectiveTrainingData.length, MAX_GRACE_SAMPLES);
      if (take <= 0) {
        return false;
      }
      if (take < effectiveTrainingData.length) {
        this.log(
          "warn",
          `Discovery recording timeout reached; capturing a small grace batch (${take}/${effectiveTrainingData.length}) to avoid empty artefacts.`,
        );
      } else {
        this.log(
          "warn",
          `Discovery recording timeout reached; capturing ${take} grace sample(s) to avoid empty artefacts.`,
        );
      }

      effectiveTrainingData = effectiveTrainingData.slice(0, take);
      if (effectiveRecordIndices) {
        effectiveRecordIndices = effectiveRecordIndices.slice(0, take);
      }
    }

    // Track selected indices if provided (from binary file processing)
    if (
      binaryFilePath && effectiveRecordIndices &&
      effectiveRecordIndices.length > 0
    ) {
      if (!this.selectedIndices[binaryFilePath]) {
        this.selectedIndices[binaryFilePath] = [];
      }
      this.selectedIndices[binaryFilePath].push(...effectiveRecordIndices);

      // Write indices to JSON file after accumulating them
      Deno.writeTextFileSync(
        this.indicesFilePath,
        JSON.stringify(this.selectedIndices),
      );

      // Store binary file path for Rust (keep first for backward compatibility)
      if (!this.rustBinaryFilePath) {
        this.rustBinaryFilePath = binaryFilePath;
      }
      // Track all binary file paths
      this.rustBinaryFilePaths.add(binaryFilePath);
    }

    // Process each record and accumulate data for Rust batch processing
    for (let i = 0; i < effectiveTrainingData.length; i++) {
      const record = effectiveTrainingData[i];

      try {
        // Discovery recording must use WASM tracing activation.
        // If WASM isn't initialised, fail fast (JS fallback is being removed).
        assert(
          isWasmActivationAvailable(),
          "WASM activation must be initialised before discovery recording",
        );

        // Discovery recording requires `Creature.record(...)`, which reads from
        // `creature.state.activations` (and benefits from stable `hintValue`s).
        //
        // WASM `activate()` is intentionally output-only and does not populate
        // `state.activations`, so discovery must use the tracing activation path.
        //
        // We intentionally trace/propagate for *all* neurons here to ensure:
        // - `state.activations` is populated for every non-input neuron
        // - `hintValue` exists for neurons reached during record() recursion
        const traceAll = {
          traceNeeded: (_uuid: string) => true,
          propagateNeeded: (_uuid: string) => true,
          updateNeeded: (_uuid: string) => true,
        };
        this.creature.activateAndTrace(
          record.input,
          false, // feedbackLoop
          // Duck-typed SparseConfig
          traceAll as unknown as import("../../propagate/sparse/SparseConfig.ts").SparseConfig,
        );
        const discoverMap = this.creature.record(record.output);

        // Accumulate data for Rust (Parquet format)
        this.rustAccumulatedData.push(record);
        this.rustAccumulatedNeuronData.push(discoverMap);
        this.rustAccumulatedEstimatedBytes += this.rustEstimatedBytesPerSample;

        // Maintain a lightweight per-neuron error aggregate as a fallback focus ranking.
        for (const [uuid, rec] of discoverMap) {
          let sumAbs = 0;
          for (const err of rec.errors) {
            if (Number.isFinite(err)) {
              sumAbs += Math.abs(err);
            }
          }
          if (sumAbs > 0) {
            const prev = this.recordedNeuronTotalAbsError.get(uuid) ?? 0;
            this.recordedNeuronTotalAbsError.set(uuid, prev + sumAbs);
          } else if (!this.recordedNeuronTotalAbsError.has(uuid)) {
            // Ensure the neuron appears in fallback ranking even if the error is zero.
            this.recordedNeuronTotalAbsError.set(uuid, 0);
          }
        }
      } catch (error) {
        // If we hit the excessive record() calls error, add context about which sample
        if (
          error instanceof Error && error.message.includes("Excessive record()")
        ) {
          getLogger().error(
            `❌ Error occurred while processing sample ${
              i + 1
            }/${trainingData.length}`,
          );
          getLogger().error(
            `   Total samples accumulated so far: ${this.rustAccumulatedData.length}`,
          );
          getLogger().error(`   Input: ${record.input.slice(0, 5)}...`);
          getLogger().error(`   Output: ${record.output.slice(0, 5)}...`);
        }
        throw error;
      }
    }

    return !timedOut;
  }

  public shouldFlushRustChunk(): boolean {
    assert(
      this.usingRustDualWrite,
      "Discovery requires Rust discovery to be enabled.",
    );
    if (this.rustAccumulatedData.length >= this.rustFlushRecords) return true;
    return this.rustAccumulatedEstimatedBytes >= this.rustFlushBytesThreshold;
  }

  /**
   * Flushes accumulated Rust recording data and writes to Parquet via Rust module.
   * This is called after all record() batches complete.
   * Returns true if Rust write succeeded or if there's no data to flush (valid no-op),
   * false if Rust not available or failed.
   *
   * NOTE: This is where we actually LOAD the Rust library (lazy loading).
   * We check file existence earlier (rustLibraryExists) to avoid loading unnecessarily.
   * If Rust module is not available, this returns false and discovery is skipped.
   * If there's no accumulated data (empty training data), this returns true (valid no-op).
   */
  private getNextChunkDir(): string {
    const index = ++this.rustChunkCounter;
    const dir = `${this.tempDir}/chunks/chunk-${
      index.toString().padStart(5, "0")
    }`;
    try {
      Deno.mkdirSync(dir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
    return dir;
  }

  private writeRustParquetChunk(tempDir: string): string | null {
    // Check if creature has been cleaned up (race condition protection)
    // @ts-ignore - creature can be null after cleanUp()
    if (!this.creature) {
      getLogger().warn(
        `⚠️  Discovery recording skipped: creature has been cleaned up.`,
      );
      return null;
    }

    if (!this.deps.isRustLibraryAvailable()) {
      getLogger().warn(
        `⚠️  Rust library not available when flushing. Discovery recording failed.`,
      );
      return null;
    }

    this.creature.validate();

    const creatureExport = this.creature.exportJSON();
    const rustCreature = creatureToRustFormat(creatureExport);
    const pendingSamples = this.rustAccumulatedData.length;

    const nonInputNeurons = this.creature.neurons.filter((neuron) =>
      neuron.type !== "input"
    );

    const rustTrainingData = this.rustAccumulatedData.map((record, index) => {
      const discoverMap = this.rustAccumulatedNeuronData[index];

      const neuronData = nonInputNeurons.map((neuron) => {
        const discoverRecord = discoverMap.get(neuron.uuid) || {
          activation: this.creature.state.activations[neuron.index],
          errors: [] as number[],
        };

        const errors = discoverRecord.errors.filter(Number.isFinite);

        return {
          neuron_uuid: neuron.uuid,
          activation: discoverRecord.activation,
          value: discoverRecord.value,
          errors: errors,
        };
      });

      return {
        input: Array.from(record.input),
        output: Array.from(record.output),
        neuron_data: neuronData,
      };
    });

    const diagnostics = this.inspectRustFlushBatch(
      rustTrainingData,
      this.creature.input,
      this.creature.output,
      nonInputNeurons.length,
    );
    const metrics = diagnostics.metrics;

    let recordIndices: number[] | undefined = undefined;
    if (this.rustBinaryFilePaths.size === 1 && this.rustBinaryFilePath) {
      const fileIndices = this.selectedIndices[this.rustBinaryFilePath];
      if (fileIndices && fileIndices.length >= pendingSamples) {
        const recentIndices = fileIndices.slice(-pendingSamples);
        recordIndices = recentIndices.slice();
      }
    }

    const now = Date.now();
    const timedOut = now > this.timeoutTS;
    if (timedOut) {
      this.log(
        "warn",
        "Submitting flush request to Rust after recording timeout expired. Continuing with captured data.",
      );
    }

    this.emitRustFlushDiagnostics(diagnostics, timedOut);

    const timeoutSeconds = timedOut
      ? 0
      : Math.max(0, Math.floor((this.timeoutTS - now) / 1000));

    const rustInput: RustRecordInput = {
      creature: rustCreature,
      "training_data": rustTrainingData,
      "temp_dir": tempDir,
      "binary_file_path": this.rustBinaryFilePath || undefined,
      "record_indices": recordIndices,
      "timeout_seconds": timeoutSeconds,
    };

    const result = this.deps.recordDiscovery(rustInput);

    if (result && result.success && result.file) {
      const parquetPath = `${tempDir}/${result.file}`;

      if (this.syntheticBinaryMode || this.rustBinaryFilePaths.size === 0) {
        this.syntheticBinaryMode = true;
        const tempBinaryFile = `${tempDir}/training_data.bin`;
        const BYTES_PER_RECORD = (this.creature.input + this.creature.output) *
          4;
        const file = Deno.openSync(tempBinaryFile, {
          create: true,
          write: true,
          truncate: true,
        });

        try {
          const buffer = new Uint8Array(BYTES_PER_RECORD);
          const recordArray = new Float32Array(buffer.buffer);
          const sequentialIndices: number[] = [];

          for (let i = 0; i < this.rustAccumulatedData.length; i++) {
            const record = this.rustAccumulatedData[i];
            for (let j = 0; j < this.creature.input; j++) {
              recordArray[j] = record.input[j];
            }
            for (let j = 0; j < this.creature.output; j++) {
              recordArray[this.creature.input + j] = record.output[j];
            }
            file.writeSync(buffer);
            sequentialIndices.push(i);
          }

          this.selectedIndices[tempBinaryFile] = sequentialIndices;
          this.rustBinaryFilePaths.add(tempBinaryFile);
          if (!this.rustBinaryFilePath) {
            this.rustBinaryFilePath = tempBinaryFile;
          }
        } finally {
          file.close();
        }
      }

      Deno.writeTextFileSync(
        this.indicesFilePath,
        JSON.stringify(this.selectedIndices),
      );

      this.rustAccumulatedData = [];
      this.rustAccumulatedNeuronData = [];
      this.rustAccumulatedEstimatedBytes = 0;

      return parquetPath;
    }

    const errorMessage = result?.error || "Unknown error";
    const errorDetails = result?.errorDetails;
    const logDetails: Record<string, unknown> = {
      pendingSamples,
      timeoutExpired: timedOut,
      binaryFilePath: this.rustBinaryFilePath,
      forcedFocusNeurons: this.forcedFocusNeurons,
      accumulatedSamples: this.rustAccumulatedData.length,
      chunkFiles: this.rustChunkFiles.length,
      longestRustUuidLength: metrics.longestNeuronUuidLength,
      totalRustUuidBytes: metrics.totalNeuronUuidBytes,
      maxRustErrorsPerNeuron: metrics.maxErrorValuesPerNeuron,
      totalRustErrorValues: metrics.totalErrorValues,
      rustRecordCount: metrics.sampleCount,
    };
    if (metrics.longestNeuronUuid && metrics.longestNeuronUuidLength > 0) {
      logDetails.longestRustUuid = metrics.longestNeuronUuid;
    }
    if (metrics.inputLength !== undefined) {
      logDetails.rustInputLength = metrics.inputLength;
    }
    if (metrics.outputLength !== undefined) {
      logDetails.rustOutputLength = metrics.outputLength;
    }
    if (errorDetails) {
      logDetails.rustRecordFailureStage = errorDetails.stage;
      if (errorDetails.inputJsonLength !== undefined) {
        logDetails.rustInputJsonLength = errorDetails.inputJsonLength;
      }
      if (errorDetails.inputBytesLength !== undefined) {
        logDetails.rustInputBytes = errorDetails.inputBytesLength;
      }
      logDetails.recordDiscoveryStats = errorDetails.stats;
    }
    this.log(
      "error",
      `Rust discovery recording failed: ${errorMessage}`,
      logDetails,
    );
    return null;
  }

  public flushRustChunk(): boolean {
    assert(
      this.usingRustDualWrite,
      "Discovery requires Rust discovery to be enabled.",
    );
    if (this.rustAccumulatedData.length === 0) {
      return false;
    }

    try {
      const chunkDir = this.getNextChunkDir();
      const parquetPath = this.writeRustParquetChunk(chunkDir);
      if (!parquetPath) {
        return false;
      }
      this.rustChunkFiles.push(parquetPath);
      return true;
    } catch (error) {
      getLogger().error("❌ Failed to flush discovery chunk:", error);
      return false;
    }
  }

  public flushRustRecording(): boolean {
    assert(
      this.usingRustDualWrite,
      "Discovery requires Rust discovery to be enabled.",
    );

    if (this.rustAccumulatedData.length > 0) {
      if (!this.flushRustChunk()) {
        return false;
      }
    }

    if (this.rustChunkFiles.length === 0) {
      this.parquetFilePath = null;
      this.combinedRustAnalysis = undefined;
      return true;
    }

    if (!this.deps.isRustLibraryAvailable()) {
      throw new Error(
        "Rust discovery library must be available when merging discovery chunks.",
      );
    }

    const outputFile = `${this.tempDir}/discovery_data.parquet`;
    const chunkFilesToCleanup = [...this.rustChunkFiles];
    const mergeResult = this.deps.mergeDiscoveryParquet({
      outputFile,
      inputFiles: [...this.rustChunkFiles],
    });

    if (!mergeResult || !mergeResult.success) {
      getLogger().error(
        "❌ Rust discovery merge failed:",
        mergeResult?.error ?? "Unknown error",
      );
      return false;
    }

    this.parquetFilePath = mergeResult.outputFile ?? outputFile;
    this.combinedRustAnalysis = undefined;
    this.rustChunkFiles = [];

    if (!this.disableCleanup) {
      for (const file of chunkFilesToCleanup) {
        try {
          Deno.removeSync(file);
        } catch {
          // Ignore cleanup failures - discovery can still proceed with merged output.
        }
        try {
          // Remove the chunk directory too (batch temp directory cleanup).
          Deno.removeSync(dirname(file), { recursive: true });
        } catch {
          // Ignore directory cleanup failures.
        }
      }
    }
    return true;
  }

  public static computeRustFlushMetrics(
    data: RustRecordInput["training_data"],
    expectedNeuronCount: number,
    expectedInputLength: number,
    expectedOutputLength: number,
  ): RustRecordBatchStats {
    return computeRustFlushMetricsImpl(
      data,
      expectedNeuronCount,
      expectedInputLength,
      expectedOutputLength,
    );
  }

  private emitRustFlushDiagnostics(
    diagnostics: RustFlushDiagnostics,
    _timedOut: boolean,
  ): void {
    // Log warnings and errors only - summary is no longer needed
    diagnostics.warnings.forEach((warning) => this.log("warn", warning));
    diagnostics.errors.forEach((error) => this.log("error", error));
  }

  private createRustFlushAggregation(
    expectedInputLength: number,
    expectedOutputLength: number,
    expectedNeuronCount: number,
  ): RustFlushAggregation {
    return createRustFlushAggregationImpl(
      expectedInputLength,
      expectedOutputLength,
      expectedNeuronCount,
    );
  }

  private observeRustTrainingRecord(
    aggregation: RustFlushAggregation,
    record: RustRecordInput["training_data"][number],
    globalSampleIndex: number,
  ): void {
    observeRustTrainingRecordImpl(aggregation, record, globalSampleIndex);
  }

  private finalizeRustFlushDiagnostics(
    aggregation: RustFlushAggregation,
  ): RustFlushDiagnostics {
    return finalizeRustFlushDiagnosticsImpl(
      aggregation,
      (value, max) => this.truncateForLog(value, max),
    );
  }

  private inspectRustFlushBatch(
    rustTrainingData: RustRecordInput["training_data"],
    expectedInputLength: number,
    expectedOutputLength: number,
    expectedNeuronCount: number,
  ): RustFlushDiagnostics {
    const aggregation = this.createRustFlushAggregation(
      expectedInputLength,
      expectedOutputLength,
      expectedNeuronCount,
    );
    rustTrainingData.forEach((record, recordIndex) => {
      this.observeRustTrainingRecord(aggregation, record, recordIndex);
    });
    return this.finalizeRustFlushDiagnostics(aggregation);
  }

  private truncateForLog(value: string, max = 120): string {
    return truncateForLogValueImpl(value, max);
  }

  private discoveries: CandidateSynapse[] = [];
  private neuronDiscoveries: CandidateNeuron[] = [];

  // deno-lint-ignore require-await
  public async analyzeSelectedNeurons(
    focusList: string[],
  ): Promise<CandidateSynapse[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeSelectedNeurons");
      this.logAnalysisSkipped("synapse");
      this.logFocusSelectionDetails("synapse", focusList);
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled()) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "Rust discovery unavailable",
      );
      return Promise.resolve(undefined);
    }

    // Populate the cache before reading from it
    this.ensureRustCombinedAnalysis(focusList, true, false);

    const rustCandidates = this.tryRustHelpfulSynapses(focusList);
    if (!rustCandidates) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "analysis did not return a result",
      );
      return Promise.resolve(undefined);
    }
    if (rustCandidates.length === 0) {
      return Promise.resolve(undefined);
    }

    rustCandidates.forEach((candidate) => this.upsertDiscovery(candidate));
    const topCandidate = rustCandidates[0];
    this.logHelpfulSynapse(topCandidate);
    return Promise.resolve(this.discoveries);
  }

  // deno-lint-ignore require-await
  public async analyzeMissingNeurons(
    focusList: string[],
  ): Promise<CandidateNeuron[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeMissingNeurons");
      this.logAnalysisSkipped("neuron");
      this.logFocusSelectionDetails("neuron", focusList);
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled()) {
      this.logRustAnalysisUnavailable(
        "neuron",
        focusList,
        "Rust discovery unavailable",
      );
      return Promise.resolve(undefined);
    }

    // Populate the cache before reading from it
    this.ensureRustCombinedAnalysis(focusList, false, true);

    const rustCandidates = this.tryRustHelpfulNeurons(focusList);
    if (!rustCandidates) {
      this.logRustAnalysisUnavailable(
        "neuron",
        focusList,
        "analysis did not return a result",
      );
      return Promise.resolve(undefined);
    }
    if (rustCandidates.length === 0) {
      return Promise.resolve(undefined);
    }

    const bestCandidates = this.filterTopNeuronCandidates(rustCandidates);
    bestCandidates.forEach((candidate) => {
      this.upsertNeuronDiscovery(candidate);
      this.logHelpfulNeuron(candidate);
    });
    return Promise.resolve(bestCandidates);
  }

  private logHelpfulSynapse(
    candidate: CandidateSynapse,
  ): void {
    this.log(
      "info",
      `Rust discovered beneficial synapse from ${candidate.fromNeuronUUID} to ${candidate.toNeuronUUID} with weight ${
        candidate.weight.toFixed(4)
      }, expected creature score gain ${
        (candidate.expectedCreatureScoreGain * 100).toFixed(1)
      }% (${candidate.improvedCount}/${candidate.totalCount} samples)`,
    );
  }

  private logHelpfulNeuron(
    candidate: CandidateNeuron,
  ): void {
    this.log(
      "info",
      `Rust discovered beneficial ${candidate.squash} neuron linking ${candidate.fromNeuronUUID} -> ${candidate.toNeuronUUID} with incoming ${
        candidate.incomingWeight.toFixed(4)
      } and outgoing ${
        candidate.outgoingWeight.toFixed(4)
      }, expected creature score gain ${
        (candidate.expectedCreatureScoreGain * 100).toFixed(1)
      }% (${candidate.improvedCount}/${candidate.totalCount} samples)`,
    );
  }

  private tryRustHelpfulNeurons(
    focusList: string[],
  ): CandidateNeuron[] | undefined {
    const rustResult = this.readRustCombinedAnalysis(
      focusList,
      false,
      true,
    )?.neuron;
    if (!rustResult) {
      return undefined;
    }

    const helpfulNeurons = rustResult.helpfulNeurons ?? [];
    if (helpfulNeurons.length === 0) {
      this.logRustNoImprovement("neuron", focusList, rustResult.diagnostics);
      return [];
    }

    const candidates = helpfulNeurons
      .map((candidate) => this.mapRustNeuronCandidate(candidate))
      .filter((candidate) => candidate.expectedCreatureScoreGain > 0);

    if (candidates.length === 0) {
      this.logRustNoImprovement("neuron", focusList, rustResult.diagnostics);
      return [];
    }

    // Candidates are already sorted by expectedCreatureScoreGain from Rust
    candidates.sort((a, b) =>
      b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
    );
    return candidates;
  }

  private tryRustCoordinatedStructuralCandidates(
    focusList: string[],
  ): CoordinatedStructuralCandidate[] | undefined {
    const rustResult = this.readRustCombinedAnalysis(
      focusList,
      false,
      true,
    )?.neuron;
    if (!rustResult) {
      return undefined;
    }

    const candidates = rustResult.coordinatedStructuralCandidates ?? [];
    if (candidates.length === 0) {
      return [];
    }

    // Prefer higher expectedCreatureScoreGain first (Rust should already sort, but keep this defensive).
    return [...candidates].sort((a, b) =>
      (b.expectedCreatureScoreGain ?? 0) - (a.expectedCreatureScoreGain ?? 0)
    );
  }

  private tryRustHelpfulSynapses(
    focusList: string[],
  ): CandidateSynapse[] | undefined {
    const rustResult = this.readRustCombinedAnalysis(
      focusList,
      true,
      false,
    )?.synapse;
    if (!rustResult) {
      return undefined;
    }

    const helpfulSynapses = rustResult.helpfulSynapses ?? [];
    if (helpfulSynapses.length === 0) {
      this.logRustNoImprovement("synapse", focusList, rustResult.diagnostics);
      return [];
    }

    const candidates = helpfulSynapses
      .map((candidate) => this.mapRustCandidate(candidate))
      .filter((candidate) => candidate.expectedCreatureScoreGain > 0);

    if (candidates.length === 0) {
      this.logRustNoImprovement("synapse", focusList, rustResult.diagnostics);
      return [];
    }

    const topCandidates = this.filterTopSynapseCandidates(candidates);
    if (topCandidates.length === 0) {
      this.logRustNoImprovement("synapse", focusList, rustResult.diagnostics);
      return [];
    }

    // Candidates are already sorted by expectedCreatureScoreGain from Rust
    topCandidates.sort((a, b) =>
      b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
    );
    return topCandidates;
  }

  private tryRustHarmfulCandidates(
    focusList: string[],
  ): CandidateSynapse[] | undefined {
    const rustResult = this.readRustCombinedAnalysis(
      focusList,
      true,
      false,
    )?.synapse;
    if (!rustResult || !rustResult.harmfulSynapses) {
      return undefined;
    }

    const candidates = rustResult.harmfulSynapses
      .map((candidate) => this.mapRustCandidate(candidate))
      .filter((candidate) => candidate.expectedCreatureScoreGain < 0);

    if (candidates.length === 0) {
      return [];
    }

    // For harmful synapses, sort by most negative (most harmful) first
    candidates.sort((a, b) =>
      a.expectedCreatureScoreGain - b.expectedCreatureScoreGain
    );
    return candidates;
  }

  public collectRustAnalysisCandidates(
    focusList: string[],
  ): CandidateAnalysisBundle | undefined {
    const combinedResult = this.ensureRustCombinedAnalysis(
      focusList,
      true, // includeSynapse
      true, // includeNeuron
    );
    if (!combinedResult) {
      return undefined;
    }

    const bundle: CandidateAnalysisBundle = {};
    if (combinedResult.synapse?.metadata) {
      bundle.synapseMetadata = combinedResult.synapse.metadata;
    }
    if (combinedResult.neuron?.metadata) {
      bundle.neuronMetadata = combinedResult.neuron.metadata;
    }

    const helpfulSynapses = this.tryRustHelpfulSynapses(focusList);
    if (helpfulSynapses && helpfulSynapses.length > 0) {
      bundle.helpfulSynapses = helpfulSynapses;
    }

    const harmfulSynapses = this.tryRustHarmfulCandidates(focusList);
    if (harmfulSynapses && harmfulSynapses.length > 0) {
      bundle.harmfulSynapse = harmfulSynapses[0];
    }

    const helpfulNeurons = this.tryRustHelpfulNeurons(focusList);
    if (helpfulNeurons && helpfulNeurons.length > 0) {
      bundle.helpfulNeurons = helpfulNeurons;
    }

    const coordinated = this.tryRustCoordinatedStructuralCandidates(focusList);
    if (coordinated && coordinated.length > 0) {
      bundle.coordinatedStructuralCandidates = coordinated;
    }

    return bundle;
  }

  private candidateKey(candidate: CandidateSynapse): string {
    return `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
  }

  private neuronCandidateKey(candidate: CandidateNeuron): string {
    return `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
  }

  private upsertDiscovery(candidate: CandidateSynapse): void {
    const key = this.candidateKey(candidate);
    const existingIndex = this.discoveries.findIndex((existing) =>
      this.candidateKey(existing) === key
    );
    if (existingIndex >= 0) {
      this.discoveries[existingIndex] = candidate;
    } else {
      this.discoveries.push(candidate);
    }
    this.discoveries.sort((a, b) =>
      b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
    );
  }

  private upsertNeuronDiscovery(candidate: CandidateNeuron): void {
    const key = this.neuronCandidateKey(candidate);
    const existingIndex = this.neuronDiscoveries.findIndex((existing) =>
      this.neuronCandidateKey(existing) === key
    );
    if (existingIndex >= 0) {
      this.neuronDiscoveries[existingIndex] = candidate;
    } else {
      this.neuronDiscoveries.push(candidate);
    }
    this.neuronDiscoveries.sort((a, b) =>
      b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
    );
  }

  private filterTopNeuronCandidates(
    candidates: CandidateNeuron[],
  ): CandidateNeuron[] {
    const grouped = new Map<string, CandidateNeuron>();
    candidates.forEach((candidate) => {
      const existing = grouped.get(candidate.toNeuronUUID);
      if (
        !existing ||
        candidate.expectedCreatureScoreGain >
          existing.expectedCreatureScoreGain
      ) {
        grouped.set(candidate.toNeuronUUID, candidate);
      }
    });
    return Array.from(grouped.values()).sort((a, b) =>
      b.expectedCreatureScoreGain - a.expectedCreatureScoreGain
    );
  }

  private filterTopSynapseCandidates(
    candidates: CandidateSynapse[],
  ): CandidateSynapse[] {
    const grouped = new Map<string, CandidateSynapse>();
    candidates.forEach((candidate) => {
      const existing = grouped.get(candidate.toNeuronUUID);
      if (
        !existing ||
        candidate.expectedCreatureScoreGain >
          existing.expectedCreatureScoreGain
      ) {
        grouped.set(candidate.toNeuronUUID, candidate);
      }
    });
    return Array.from(grouped.values());
  }

  private logHarmfulSynapse(candidate: CandidateSynapse): void {
    const harmPercent = Math.abs(candidate.expectedCreatureScoreGain * 100);
    this.log(
      "info",
      `Rust discovered harmful synapse from ${candidate.fromNeuronUUID} to ${candidate.toNeuronUUID}, expected creature score loss ${
        harmPercent.toFixed(1)
      }% (${candidate.improvedCount}/${candidate.totalCount} samples)`,
    );
  }

  private mapRustCandidate(
    candidate: RustCandidateSynapse,
  ): CandidateSynapse {
    return {
      fromNeuronUUID: candidate.fromNeuronUuid,
      toNeuronUUID: candidate.toNeuronUuid,
      weight: candidate.weight,
      targetNeuronImpact: candidate.targetNeuronImpact,
      expectedCreatureErrorReduction: candidate.expectedCreatureErrorReduction,
      expectedCreatureScoreGain: candidate.expectedCreatureScoreGain,
      improvedCount: candidate.improvedCount,
      totalCount: candidate.totalCount,
      comment: candidate.comment,
      targetNeuronStats: candidate.targetNeuronStats,
    };
  }

  private mapRustNeuronCandidate(
    candidate: RustCandidateNeuron,
  ): CandidateNeuron {
    return {
      fromNeuronUUID: candidate.sourceNeuronUuid,
      toNeuronUUID: candidate.targetNeuronUuid,
      incomingWeight: candidate.incomingWeight,
      outgoingWeight: candidate.outgoingWeight,
      squash: candidate.squash,
      bias: candidate.bias,
      targetNeuronImpact: candidate.targetNeuronImpact,
      expectedCreatureErrorReduction: candidate.expectedCreatureErrorReduction,
      expectedCreatureScoreGain: candidate.expectedCreatureScoreGain,
      improvedCount: candidate.improvedCount,
      totalCount: candidate.totalCount,
      comment: candidate.comment,
      targetNeuronStats: candidate.targetNeuronStats,
    };
  }

  /**
   * Analyzes recorded neuron data to identify and evaluate potential synapse additions.
   *
   * @param discoveryMaxNeurons - Number of neurons to consider, weighted by error magnitude
   * @param costOfGrowth - Cost threshold from NEAT options for filtering viable neurons
   * @returns Candidate synapses ordered by benefit estimate, or undefined if none were found
   */
  public async analyze(
    discoveryMaxNeurons: number,
    costOfGrowth: number,
  ): Promise<CandidateSynapse[] | undefined> {
    if (this.recorded === false) {
      this.log("warn", "No recorded data to analyze.");
      return undefined;
    }
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
      costOfGrowth,
    );
    return this.analyzeSelectedNeurons(focusList);
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ): void {
    const prefix = `[Discovery ${this.discoveryID}] ${message}`;
    const args = details === undefined ? [prefix] : [prefix, details];

    switch (level) {
      case "debug":
        if (this.loggingEnabled) getLogger().debug(...args);
        break;
      case "info":
        if (this.loggingEnabled) getLogger().info(...args);
        break;
      case "warn":
        getLogger().warn(...args);
        break;
      case "error":
        getLogger().error(...args);
        break;
      default:
        getLogger().info(...args);
        break;
    }
  }

  private focusSelectionKey(focusList: readonly string[]): string {
    return focusList.join("|");
  }

  private updateFocusSelectionSummary(
    mode: FocusSelectionMode,
    focusNeurons: readonly string[],
    weightMap?: Map<string, number>,
    totalWeight?: number,
    reason = "",
  ): void {
    const neurons = focusNeurons.map((uuid) => ({
      uuid,
      weight: weightMap?.get(uuid),
    }));
    this.lastFocusSelection = {
      key: this.focusSelectionKey(focusNeurons),
      mode,
      reason,
      neurons,
      totalWeight,
    };
    if (this.loggingEnabled && mode === "weighted") {
      const preview = neurons.slice(0, Math.min(3, neurons.length)).map((
        entry,
      ) =>
        entry.weight !== undefined
          ? `${entry.uuid} (weight ${entry.weight.toFixed(4)})`
          : entry.uuid
      ).join(", ");
      this.log(
        "info",
        `Weighted error x impact selection prioritised: ${preview}${
          neurons.length > 3 ? ", …" : ""
        }`,
      );
    }
  }

  /**
   * Writes focus selection analysis to a JSON file for debugging and validation.
   * Documents all candidate neurons, their metrics, and which were selected.
   * Ordered by potential error reduction to show best candidates first.
   */
  private writeFocusSelectionAnalysis(
    neuronErrors: NeuronErrorInfo[],
    selectedUUIDs: Set<string>,
    totalWeightedSum: number,
    selectionMethod: string,
    costOfGrowth: number,
    retryNumber?: number,
  ): void {
    try {
      const selectedSet = new Set(selectedUUIDs);

      // Calculate all metrics for each candidate neuron
      const candidates: FocusNeuronCandidate[] = neuronErrors.map((neuron) => {
        const potentialErrorReduction = neuron.totalError * neuron.impact;
        const activationAffectPct = neuron.impact * 100;
        // Use squared weighting to match selection logic - strongly favours high-potential neurons
        const weightedScore = potentialErrorReduction * potentialErrorReduction;

        return {
          neuronUuid: neuron.uuid,
          totalError: neuron.totalError,
          impact: neuron.impact,
          potentialErrorReduction,
          activationAffectPct,
          weightedScore,
          selected: selectedSet.has(neuron.uuid),
        };
      });

      // Sort by potential error reduction (descending)
      candidates.sort((a, b) =>
        b.potentialErrorReduction - a.potentialErrorReduction
      );

      // Identify low-impact neurons (activation affect < costOfGrowth)
      const lowImpactThreshold = costOfGrowth;
      const lowImpactNeurons: LowImpactNeuron[] = neuronErrors
        .filter((n) => n.impact < lowImpactThreshold)
        .map((n) => ({
          neuronUuid: n.uuid,
          impact: n.impact,
          activationAffectPct: n.impact * 100,
          totalError: n.totalError,
          reason: `Impact ${
            n.impact.toFixed(6)
          } < cost of growth ${lowImpactThreshold}`,
        }))
        .sort((a, b) => a.impact - b.impact); // Sort by impact ascending (lowest first)

      const analysis: FocusSelectionAnalysis = {
        discoveryID: this.discoveryID,
        timestamp: new Date().toISOString(),
        costOfGrowth,
        selectionMethod,
        totalCandidates: candidates.length,
        selectedCount: selectedUUIDs.size,
        totalWeightedSum,
        candidates,
        lowImpactNeurons,
        retryNumber,
      };

      const retryPart = retryNumber !== undefined
        ? `-retry-${retryNumber}`
        : "";
      const filename = `focus-selection${retryPart}.json`;
      const filepath = `${this.tempDir}/${filename}`;

      Deno.writeTextFileSync(filepath, JSON.stringify(analysis, null, 2));

      if (this.loggingEnabled) {
        this.log(
          "info",
          `Wrote focus selection analysis to ${filepath} (${candidates.length} candidates, ${selectedUUIDs.size} selected, ${lowImpactNeurons.length} low-impact)`,
        );
      }
    } catch (error) {
      // Don't fail discovery if we can't write the analysis file
      getLogger().warn(
        `Failed to write focus selection analysis: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private logFocusSelectionDetails(
    scope: "synapse" | "neuron",
    focusList: string[],
  ): void {
    const summary = this.lastFocusSelection;
    const focusKey = this.focusSelectionKey(focusList);
    if (!summary || summary.key !== focusKey) {
      this.log(
        "warn",
        `Focus selection summary unavailable for ${scope} analysis (focus=${
          focusList.join(", ")
        })`,
      );
      return;
    }
    const displayEntries = summary.neurons.slice(
      0,
      Math.min(5, summary.neurons.length),
    ).map((entry) =>
      entry.weight !== undefined
        ? `${entry.uuid} (weight ${entry.weight.toFixed(4)})`
        : entry.uuid
    );
    const suffix = summary.neurons.length > displayEntries.length ? ", …" : "";
    const totalInfo = summary.totalWeight !== undefined
      ? ` totalWeight=${summary.totalWeight.toFixed(4)}`
      : "";
    this.log(
      "warn",
      `Focus selection [${summary.mode}] ${
        summary.reason ? `(${summary.reason}) ` : ""
      }for ${scope} analysis: ${
        displayEntries.join(", ")
      }${suffix}${totalInfo}`,
    );
  }

  private logRustNoImprovement(
    scope: "synapse" | "neuron",
    focusList: string[],
    diagnostics?: RustSynapseDiagnostic[] | RustNeuronDiagnostic[],
  ): void {
    const preview = focusList.length > 10
      ? `${focusList.slice(0, 10).join(", ")} … (+${
        focusList.length - 10
      } more)`
      : focusList.join(", ");
    this.log(
      "warn",
      `Rust ${scope} analysis evaluated ${focusList.length} focus neuron(s) but found no improvements. Focus neurons: ${preview}`,
    );
    this.logFocusSelectionDetails(scope, focusList);
    this.logRustDiagnostics(scope, diagnostics);
  }

  private logRustAnalysisUnavailable(
    scope: "synapse" | "neuron",
    focusList: string[],
    reason: string,
  ): void {
    if (focusList.length === 0) {
      return;
    }
    const preview = focusList.length > 10
      ? `${focusList.slice(0, 10).join(", ")} … (+${
        focusList.length - 10
      } more)`
      : focusList.join(", ");
    this.log(
      "warn",
      `Rust ${scope} analysis unavailable (${reason}) for focus neuron(s): ${preview}`,
    );
    this.logFocusSelectionDetails(scope, focusList);
  }

  private buildCombinedAnalysisKey(
    focusList: readonly string[],
  ): string {
    const pathKey = this.parquetFilePath ?? "none";
    return `${pathKey}|${JSON.stringify(focusList)}`;
  }

  public ensureRustCombinedAnalysis(
    focusList: string[],
    includeSynapse: boolean,
    includeNeuron: boolean,
  ): RustAnalyzeAllResult | undefined {
    if (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled()) {
      return undefined;
    }

    if (!includeSynapse && !includeNeuron) {
      return undefined;
    }

    const cacheKey = this.buildCombinedAnalysisKey(focusList);
    if (
      this.combinedRustAnalysis &&
      this.combinedRustAnalysis.key === cacheKey &&
      (!includeSynapse || this.combinedRustAnalysis.includeSynapse) &&
      (!includeNeuron || this.combinedRustAnalysis.includeNeuron)
    ) {
      return this.combinedRustAnalysis.result;
    }

    const rustCreature = creatureToRustFormat(this.creature.exportJSON());

    // Calculate each focus neuron's share of the creature's total error.
    // This allows Rust to estimate creature-level improvement (not just neuron-level)
    // so it can properly rank candidates before truncating.
    const impactEstimator = new CreatureErrorImpactEstimator(this.creature);
    const focusNeuronErrorShares: Record<string, number> = {};
    for (const uuid of focusList) {
      focusNeuronErrorShares[uuid] = impactEstimator.getNeuronShare(uuid);
    }

    const parallelInput: RustParallelAnalysisInput = {
      parquetFile: this.parquetFilePath,
      creature: rustCreature,
      focusNeurons: focusList,
      maxSynapseCandidates: includeSynapse
        ? Math.max(50, focusList.length * 10)
        : undefined,
      maxNeuronCandidates: includeNeuron
        ? Math.max(25, focusList.length * 5)
        : undefined,
      requireGpu: Deno.build.os === "darwin",
      analysisDeadlineMs: this.analysisDeadlineMs,
      focusNeuronErrorShares,
    };

    const parallelResult = this.deps.analyzeParallel(parallelInput);
    if (!parallelResult || !parallelResult.success) {
      const reason = parallelResult?.error ??
        "analysis did not return a result";
      if (includeSynapse) {
        this.logRustAnalysisUnavailable("synapse", focusList, reason);
      }
      if (includeNeuron) {
        this.logRustAnalysisUnavailable("neuron", focusList, reason);
      }
      this.combinedRustAnalysis = undefined;
      return undefined;
    }
    const converted = this.convertParallelAnalysisResult(parallelResult);
    this.combinedRustAnalysis = {
      key: cacheKey,
      includeSynapse,
      includeNeuron,
      result: converted,
    };
    return converted;
  }

  private readRustCombinedAnalysis(
    focusList: string[],
    needsSynapse: boolean,
    needsNeuron: boolean,
  ): RustAnalyzeAllResult | undefined {
    const cached = this.combinedRustAnalysis;
    if (!cached) {
      return undefined;
    }
    if (cached.key !== this.buildCombinedAnalysisKey(focusList)) {
      return undefined;
    }
    if (needsSynapse && !cached.includeSynapse) {
      return undefined;
    }
    if (needsNeuron && !cached.includeNeuron) {
      return undefined;
    }
    return cached.result;
  }

  private convertParallelAnalysisResult(
    parallel: RustParallelAnalysisResult,
  ): RustAnalyzeAllResult {
    const hasSynapsePayload = Boolean(
      parallel.helpfulSynapses?.length ||
        parallel.harmfulSynapses?.length ||
        parallel.synapseDiagnostics?.length,
    );
    const hasNeuronPayload = Boolean(
      parallel.helpfulNeurons?.length ||
        parallel.coordinatedStructuralCandidates?.length ||
        parallel.neuronDiagnostics?.length,
    );

    const synapseResult: RustAnalyzeSynapsesResult | undefined =
      hasSynapsePayload
        ? {
          success: true,
          gpuUsed: parallel.synapseGpuUsed,
          metadata: parallel.synapseMetadata,
          helpfulSynapses: parallel.helpfulSynapses,
          harmfulSynapses: parallel.harmfulSynapses,
          diagnostics: parallel.synapseDiagnostics,
        }
        : undefined;
    const neuronResult: RustAnalyzeNeuronsResult | undefined = hasNeuronPayload
      ? {
        success: true,
        gpuUsed: parallel.neuronGpuUsed,
        metadata: parallel.neuronMetadata,
        helpfulNeurons: parallel.helpfulNeurons,
        coordinatedStructuralCandidates:
          parallel.coordinatedStructuralCandidates,
        diagnostics: parallel.neuronDiagnostics,
      }
      : undefined;

    return {
      success: parallel.success,
      synapse: synapseResult,
      neuron: neuronResult,
      error: parallel.error,
    };
  }

  private logAnalysisSkipped(scope: "synapse" | "neuron"): void {
    const stats = this.lastNeuronScanStats;
    if (!stats?.timedOut) {
      return;
    }
    this.log(
      "warn",
      `Skipping Rust ${scope} analysis because neuron scanning consumed ${
        this.formatMillis(stats.durationMs)
      } (${stats.processed}/${stats.total} neurons processed).`,
    );
  }

  private isSynapseDiagnostic(
    diagnostic: RustSynapseDiagnostic | RustNeuronDiagnostic,
  ): diagnostic is RustSynapseDiagnostic {
    return Object.prototype.hasOwnProperty.call(
      diagnostic,
      "evaluatedCandidates",
    );
  }

  private logRustDiagnostics(
    scope: "synapse" | "neuron",
    diagnostics?: RustSynapseDiagnostic[] | RustNeuronDiagnostic[],
  ): void {
    if (!diagnostics || diagnostics.length === 0) {
      this.log(
        "warn",
        `Rust ${scope} analysis did not return diagnostic detail for the evaluated neurons.`,
      );
      return;
    }
    let totalEvaluated = 0;
    let bestImprovement = Number.NEGATIVE_INFINITY;
    let bestDetail:
      | {
        improvement: number;
        threshold?: number;
        weight?: number;
        target: string;
      }
      | undefined;
    diagnostics.forEach((diagnostic) => {
      const evaluated = (diagnostic as RustSynapseDiagnostic)
        .evaluatedCandidates ??
        (diagnostic as RustNeuronDiagnostic).evaluatedSources ??
        0;
      totalEvaluated += evaluated;
      const detail = diagnostic.detail;
      if (detail) {
        const improvement = typeof detail.expectedCreatureScoreGain ===
            "number"
          ? detail.expectedCreatureScoreGain
          : undefined;
        if (
          improvement !== undefined &&
          improvement > bestImprovement
        ) {
          bestImprovement = improvement;
          bestDetail = {
            improvement,
            threshold: detail.threshold,
            weight: (("suggestedWeight" in detail &&
                typeof (detail as RustSynapseDiagnosticDetail)
                    .suggestedWeight === "number")
              ? (detail as RustSynapseDiagnosticDetail).suggestedWeight
              : undefined) ??
              (("outgoingWeight" in detail &&
                  typeof (detail as RustNeuronDiagnosticDetail)
                      .outgoingWeight === "number")
                ? (detail as RustNeuronDiagnosticDetail).outgoingWeight
                : undefined),
            target: diagnostic.targetNeuronUuid,
          };
        }
      }
      if (this.isSynapseDiagnostic(diagnostic)) {
        this.log("warn", this.formatSynapseDiagnostic(diagnostic));
      } else {
        this.log("warn", this.formatNeuronDiagnostic(diagnostic));
      }
    });
    if (totalEvaluated > 0) {
      if (bestDetail) {
        const improvementPct = `${(bestDetail.improvement * 100).toFixed(4)}%`;
        const thresholdPct = bestDetail.threshold !== undefined
          ? `${(bestDetail.threshold * 100).toFixed(4)}%`
          : "the configured threshold";
        const weightInfo = bestDetail.weight !== undefined
          ? ` (weight ${bestDetail.weight.toFixed(4)})`
          : "";
        this.log(
          "warn",
          `Rust ${scope} analysis evaluated ${totalEvaluated} candidate(s); best improvement ${improvementPct} for ${bestDetail.target}${weightInfo} but threshold was ${thresholdPct}.`,
        );
      } else {
        this.log(
          "warn",
          `Rust ${scope} analysis evaluated ${totalEvaluated} candidate(s) but none produced usable improvement statistics.`,
        );
      }
    } else {
      const first = diagnostics[0];
      if (first) {
        const reason = this.isSynapseDiagnostic(first)
          ? this.describeSynapseDiagnosticReason(first.reason)
          : this.describeNeuronDiagnosticReason(first.reason);
        this.log(
          "warn",
          `Rust ${scope} analysis reported zero evaluated candidates (${reason}).`,
        );
      } else {
        this.log(
          "warn",
          `Rust ${scope} analysis reported zero evaluated candidates.`,
        );
      }
    }
  }

  private formatSynapseDiagnostic(diagnostic: RustSynapseDiagnostic): string {
    const reason = this.describeSynapseDiagnosticReason(diagnostic.reason);
    const detailParts = [
      `evaluated=${diagnostic.evaluatedCandidates}`,
      `withSamples=${diagnostic.candidatesWithSamples}`,
      `targetRecords=${diagnostic.targetRecordCount}`,
    ];
    if (diagnostic.detail) {
      const detail = diagnostic.detail;
      if (detail.sourceNeuronUuid) {
        detailParts.push(`source=${detail.sourceNeuronUuid}`);
      }
      if (detail.sampleCount !== undefined) {
        detailParts.push(`samples=${detail.sampleCount}`);
      }
      if (
        detail.improvedCount !== undefined ||
        detail.worsenedCount !== undefined
      ) {
        detailParts.push(
          `improved=${detail.improvedCount ?? 0}/worsened=${
            detail.worsenedCount ?? 0
          }`,
        );
      }
      if (detail.expectedCreatureScoreGain !== undefined) {
        detailParts.push(
          `expected=${(detail.expectedCreatureScoreGain * 100).toFixed(2)}%`,
        );
      }
      if (detail.threshold !== undefined) {
        detailParts.push(`threshold=${(detail.threshold * 100).toFixed(2)}%`);
      }
      if (detail.suggestedWeight !== undefined) {
        detailParts.push(`weight=${detail.suggestedWeight.toFixed(4)}`);
      }
    }
    return `Rust synapse diagnostic for ${diagnostic.targetNeuronUuid}: ${reason} (${
      detailParts.join(", ")
    })`;
  }

  private formatNeuronDiagnostic(diagnostic: RustNeuronDiagnostic): string {
    const reason = this.describeNeuronDiagnosticReason(diagnostic.reason);
    const detailParts = [
      `evaluated=${diagnostic.evaluatedSources}`,
      `withSamples=${diagnostic.sourcesWithSamples}`,
      `targetRecords=${diagnostic.targetRecordCount}`,
    ];
    if (diagnostic.detail) {
      const detail = diagnostic.detail;
      if (detail.sourceNeuronUuid) {
        detailParts.push(`source=${detail.sourceNeuronUuid}`);
      }
      if (detail.orientation) {
        detailParts.push(`orientation=${detail.orientation}`);
      }
      if (detail.sampleCount !== undefined) {
        detailParts.push(`samples=${detail.sampleCount}`);
      }
      if (
        detail.improvedCount !== undefined ||
        detail.worsenedCount !== undefined
      ) {
        detailParts.push(
          `improved=${detail.improvedCount ?? 0}/worsened=${
            detail.worsenedCount ?? 0
          }`,
        );
      }
      if (detail.expectedCreatureScoreGain !== undefined) {
        detailParts.push(
          `expected=${(detail.expectedCreatureScoreGain * 100).toFixed(2)}%`,
        );
      }
      if (detail.threshold !== undefined) {
        detailParts.push(`threshold=${(detail.threshold * 100).toFixed(2)}%`);
      }
      if (detail.outgoingWeight !== undefined) {
        detailParts.push(`outgoing=${detail.outgoingWeight.toFixed(4)}`);
      }
    }
    return `Rust neuron diagnostic for ${diagnostic.targetNeuronUuid}: ${reason} (${
      detailParts.join(", ")
    })`;
  }

  private describeSynapseDiagnosticReason(
    reason: RustSynapseDiagnostic["reason"],
  ): string {
    switch (reason) {
      case "no_eligible_sources":
        // Note: This may indicate a Rust library issue - all non-input neurons should have
        // inward synapses. If this appears for valid neurons, it may be a filtering issue
        // in the Rust library (e.g., all potential sources are already connected or filtered out).
        return "No eligible upstream sources";
      case "no_diagnostics":
        return "No diagnostics recorded";
      case "no_samples":
        return "No aligned samples found";
      case "zero_improvement":
        return "Zero net improvement observed";
      case "below_threshold":
        return "Expected improvement below threshold";
      default:
        return reason;
    }
  }

  private describeNeuronDiagnosticReason(
    reason: RustNeuronDiagnostic["reason"],
  ): string {
    switch (reason) {
      case "no_eligible_sources":
        // Note: This may indicate a Rust library issue - all non-input neurons should have
        // inward synapses. If this appears for valid neurons, it may be a filtering issue
        // in the Rust library (e.g., all potential sources are already connected or filtered out).
        return "No eligible upstream sources";
      case "no_diagnostics":
        return "No diagnostics recorded";
      case "no_samples":
        return "No aligned samples detected";
      case "not_enough_activations":
        return "Not enough activations to evaluate";
      case "weight_degenerate":
        return "Degenerate outgoing weight";
      case "below_threshold":
        return "Expected improvement below threshold";
      default:
        return reason;
    }
  }

  private formatMillis(duration: number): string {
    const seconds = Math.floor(duration / 1000);
    const milliseconds = duration % 1000;
    if (seconds <= 0) {
      return `${milliseconds}ms`;
    }
    return `${seconds}s ${milliseconds.toString().padStart(3, "0")}ms`;
  }

  public listNeuronsByImpact(): NeuronImpactInfo[] {
    const entries: NeuronImpactInfo[] = this.creature.neurons
      .filter((neuron) => this.isSelectableNeuron(neuron))
      .map((neuron) => ({
        uuid: neuron.uuid,
        neuronType: neuron.type,
        impact: this.calculateNeuronImpact(neuron.uuid),
      }))
      .map((entry) => ({
        ...entry,
        impact: Number.isFinite(entry.impact) && entry.impact > 0
          ? entry.impact
          : 0,
      }));

    entries.sort((a, b) => {
      const delta = b.impact - a.impact;
      if (Math.abs(delta) > 1e-6) {
        return delta;
      }
      if (a.neuronType !== b.neuronType) {
        return a.neuronType === "output" ? -1 : 1;
      }
      return a.uuid.localeCompare(b.uuid);
    });

    this.sanityCheckImpactOrdering(entries);
    return entries;
  }

  private sanityCheckImpactOrdering(entries: NeuronImpactInfo[]): void {
    const outputCount =
      this.creature.neurons.filter((n) => n.type === "output").length;
    if (outputCount === 0 || entries.length === 0) {
      return;
    }

    const topSlice = entries.slice(0, Math.min(outputCount, entries.length));
    const violation = topSlice.find((entry) => entry.neuronType !== "output");
    if (violation) {
      const message =
        "Impact ordering sanity check failed: expected output neurons at the top of the list.";
      this.log("error", message, { topSlice });
      throw new Error(message);
    }
  }

  private async openFileWithRetry(
    file: string,
    maxRetries = 5,
    initialDelay = 200,
  ): Promise<Deno.FsFile> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
      try {
        // deno-lint-ignore no-await-in-loop
        return await Deno.open(file);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Too many open files") && retries < maxRetries
        ) {
          getLogger().warn(
            `Too many open files, retrying in ${delay}ms (attempt ${
              retries + 1
            }/${maxRetries})`,
          );
          // deno-lint-ignore no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          retries++;
          continue;
        }
        throw error; // Re-throw if it's not a "Too many open files" error or we've exhausted retries
      }
    }
  }

  /**
   * Loads input neuron activation data directly from binary files using stored indices.
   * Input neurons are stored in binary format as they're not written to Parquet.
   */
  private async loadInputNeuronFromBinary(
    neuronIndex: number,
  ): Promise<DiscoverRecord[]> {
    // Read the selected indices from JSON file
    const indicesContent = await Deno.readTextFile(this.indicesFilePath);
    const indices: BinaryRecordIndices = JSON.parse(indicesContent);

    const records: DiscoverRecord[] = [];
    const BYTES_PER_RECORD = (this.creature.input + this.creature.output) * 4;

    // Process each binary file that has selected indices
    // Collect file reading promises to avoid await in loop
    const fileReadPromises = Object.entries(indices).map(
      async ([binaryFile, recordIndices]) => {
        const file = await this.openFileWithRetry(binaryFile);
        const fileRecords: DiscoverRecord[] = [];

        try {
          const recordBuffer = new Uint8Array(BYTES_PER_RECORD);
          const recordArray = new Float32Array(recordBuffer.buffer);

          for (const recordIndex of recordIndices) {
            // Seek to the record position
            const targetPosition = recordIndex * BYTES_PER_RECORD;
            file.seekSync(targetPosition, Deno.SeekMode.Start);

            // Read the record
            const bytesRead = file.readSync(recordBuffer);
            if (bytesRead === null || bytesRead !== BYTES_PER_RECORD) {
              getLogger().warn(
                `Failed to read record ${recordIndex} from ${binaryFile}`,
              );
              continue;
            }

            // Extract the input value at the specified index
            // Binary format: [input0, input1, ..., inputN, output0, ..., outputM]
            const activation = recordArray[neuronIndex];

            fileRecords.push({
              activation,
              errors: [], // Input neurons don't have errors
            });
          }
        } finally {
          file.close();
        }

        return fileRecords;
      },
    );

    // Wait for all file reads to complete
    const allFileRecords = await Promise.all(fileReadPromises);

    // Flatten the results into a single array
    for (const fileRecords of allFileRecords) {
      records.push(...fileRecords);
    }

    return records;
  }

  /**
   * Loads discovery records for a neuron from Parquet storage via Rust.
   * Note: Input neurons are read from binary files as they're never written to Parquet.
   */
  private async loadNeuronRecords(
    neuronIdentifier: string,
  ): Promise<DiscoverRecord[]> {
    // Check if this is an input neuron - always read from binary files
    const fileName = neuronIdentifier.split("/").pop();
    if (fileName && fileName.startsWith("input-")) {
      // Extract neuron index from filename like "input-5.csv" (legacy naming)
      const match = fileName.match(/^input-(\d+)(?:\.csv)?$/);
      if (match) {
        const neuronIndex = parseInt(match[1], 10);

        // Always read from binary files (input neurons are never in Parquet)
        try {
          const indicesContent = await Deno.readTextFile(this.indicesFilePath);
          const indices: BinaryRecordIndices = JSON.parse(indicesContent);

          // If we have binary indices, use them
          if (Object.keys(indices).length > 0) {
            return await this.loadInputNeuronFromBinary(neuronIndex);
          }
        } catch {
          // No indices file or empty - return empty
          return [];
        }
      }
    }

    // For non-input neurons, read from Parquet (Rust is required)
    if (!this.parquetFilePath) {
      throw new Error(
        "Parquet file path not set. Discovery requires the NEAT-AI-Discovery Rust library.",
      );
    }

    // Extract neuron UUID from identifier (strip .csv extension if present)
    const match = fileName?.match(/^(.+?)(?:\.csv)?$/);
    if (!match) {
      throw new Error(`Invalid neuron identifier: ${fileName}`);
    }
    const neuronUUID = match[1];

    // Verify Parquet file exists before reading
    try {
      Deno.statSync(this.parquetFilePath);
    } catch {
      throw new Error(
        `Parquet file does not exist: ${this.parquetFilePath}`,
      );
    }

    // Read from Parquet via Rust FFI
    const readResult = this.deps.readDiscoveryRecords({
      parquet_file: this.parquetFilePath,
      neuron_uuid: neuronUUID,
    });

    if (readResult && readResult.success && readResult.records) {
      // Convert Rust records to TypeScript format
      // Sort by obs_index to ensure records are in the same order as they were written
      const sortedRecords = [...readResult.records].sort(
        (a, b) => a.obs_index - b.obs_index,
      );
      const converted = sortedRecords.map((r) => ({
        activation: r.activation,
        value: r.value ?? r.activation, // Use activation as fallback for value
        errors: [...r.errors],
      }));

      return converted;
    } else {
      // Rust reading failed
      throw new Error(
        `Failed to read discovery records from Parquet: ${
          readResult?.error || "Unknown error"
        }`,
      );
    }
  }

  /**
   * Calculates the impact of a neuron on the network outputs.
   * Impact is defined as the maximum weight path to any output neuron.
   * The value is between 0 and 1 (or potentially higher if weights > 1, but typically scaled).
   *
   * @param neuronUUID - The UUID of the neuron to calculate impact for
   * @param derivativeMap - Optional map of average derivatives to account for saturation
   * @returns The impact value (maximum absolute weight path to outputs)
   */
  private calculateNeuronImpact(
    neuronUUID: string,
    derivativeMap?: Map<string, number>,
  ): number {
    if (!this.neuronImpactEstimator) {
      this.neuronImpactEstimator = new CreatureErrorImpactEstimator(
        this.creature,
      );
    }
    if (!this.neuronIndexMap) {
      this.neuronIndexMap = new Map<string, number>();
      this.creature.neurons.forEach((neuron, index) => {
        this.neuronIndexMap!.set(neuron.uuid, index);
      });
    }
    const share = this.neuronImpactEstimator.getNeuronShare(neuronUUID);
    if (!Number.isFinite(share) || share <= 0) {
      return 0;
    }
    let derivative = derivativeMap?.get(neuronUUID);
    if (derivative === undefined) {
      derivative = this.computeSquashDerivative(neuronUUID);
    }
    const derivativeFactor = Number.isFinite(derivative)
      ? Math.max(derivative, 0)
      : 1;
    const downstreamCache = new Map<string, number>();
    const computeDownstreamFactor = (
      uuid: string,
      path: Set<string>,
    ): number => {
      if (downstreamCache.has(uuid)) {
        return downstreamCache.get(uuid)!;
      }
      const index = this.neuronIndexMap!.get(uuid);
      if (index === undefined) {
        return 1;
      }
      const neuron = this.creature.neurons[index];
      if (neuron.type === "output") {
        downstreamCache.set(uuid, 1);
        return 1;
      }
      const outward = this.creature.outwardConnections(index);
      if (!outward || outward.length === 0) {
        downstreamCache.set(uuid, 1);
        return 1;
      }
      let maxProduct = 0;
      for (const synapse of outward) {
        const toNeuron = this.creature.neurons[synapse.to];
        if (!toNeuron) continue;
        if (path.has(toNeuron.uuid)) {
          continue;
        }
        path.add(toNeuron.uuid);
        const downstreamDerivative = derivativeMap?.get(toNeuron.uuid) ??
          this.computeSquashDerivative(toNeuron.uuid);
        const childFactor = computeDownstreamFactor(toNeuron.uuid, path);
        path.delete(toNeuron.uuid);
        const product = Math.max(0, downstreamDerivative) * childFactor;
        if (product > maxProduct) {
          maxProduct = product;
        }
      }
      const factor = maxProduct > 0 ? Math.min(1, maxProduct) : 0;
      downstreamCache.set(uuid, factor);
      return factor;
    };

    const downstreamFactor = computeDownstreamFactor(
      neuronUUID,
      new Set<string>([neuronUUID]),
    );

    return Math.min(1, share * derivativeFactor * downstreamFactor);
  }

  /**
   * Computes the squash function derivative for a neuron at its current activation.
   * Uses the most recent activation from creature.state if available, otherwise returns 1.0.
   *
   * WARNING: This method relies on creature.state which may be stale or uninitialized
   * during offline analysis (e.g., in findCandidateSquash). When a derivativeMap is
   * provided to calculateNeuronImpact, this method should NOT be used as a fallback.
   *
   * This accounts for saturation effects where neurons operating in saturated regions
   * (e.g., TANH at large inputs) have very small derivatives and thus limited impact
   * on output error regardless of their local error magnitude.
   *
   * For squash functions where we can compute the derivative from the output (like TANH, SIGMOID),
   * we use the analytical formula. For others, we return 1.0 as a conservative estimate.
   */
  private computeSquashDerivative(neuronUUID: string): number {
    const neuron = this.creature.neurons.find((n) => n.uuid === neuronUUID);
    if (!neuron || neuron.type === "input" || neuron.type === "constant") {
      return 1.0;
    }

    const squashName = neuron.squash ?? "IDENTITY";
    const activation = this.creature.state.activations[neuron.index];

    if (!Number.isFinite(activation)) {
      return 1.0;
    }

    // Use analytical derivative formulas where possible
    // For TANH: d/dx tanh(x) = 1 - tanh²(x) = 1 - activation²
    // For SIGMOID: d/dx σ(x) = σ(x)(1 - σ(x)) = activation * (1 - activation)
    switch (squashName) {
      case "IDENTITY":
        return 1.0;
      case "TANH": {
        const derivative = 1 - activation * activation;
        return Number.isFinite(derivative) && derivative >= 0 ? derivative : 0;
      }
      case "LOGISTIC":
      case "SIGMOID": {
        const derivative = activation * (1 - activation);
        return Number.isFinite(derivative) && derivative >= 0 ? derivative : 0;
      }
      case "RELU":
        return activation > 0 ? 1.0 : 0.0;
      case "LEAKY_RELU":
        return activation > 0 ? 1.0 : 0.01;
      default:
        // For other activation functions, we can't easily compute the derivative
        // from just the output, so return 1.0 as a conservative estimate
        return 1.0;
    }
  }

  /**
   * Lists neurons sorted by their total error, useful for error-driven selection processes.
   * Now also includes impact calculation for weighted selection.
   */
  public listViableNeurons(
    targetCount?: number,
  ): NeuronErrorInfo[] {
    if (!this.recorded) {
      getLogger().warn("No recorded data to list neurons.");
      return [];
    }

    const rustResult = this.tryRustFocusRanking(targetCount);
    if (rustResult && rustResult.length > 0) {
      return rustResult;
    }
    if (
      rustResult && rustResult.length === 0 &&
      this.recordedNeuronTotalAbsError.size > 0
    ) {
      this.log(
        "warn",
        "Rust focus ranking returned 0 neuron(s). Falling back to local recorded error aggregation for focus selection.",
      );
      return this.fallbackViableNeuronsFromRecordedErrors(targetCount);
    }
    if (!rustResult && this.recordedNeuronTotalAbsError.size > 0) {
      this.log(
        "warn",
        "Rust focus ranking unavailable. Falling back to local recorded error aggregation for focus selection.",
      );
      return this.fallbackViableNeuronsFromRecordedErrors(targetCount);
    }

    // Rust discovery is required - no fallback
    getLogger().error(
      `❌ CRITICAL: Rust focus ranking failed. Discovery cannot proceed without Rust analysis.`,
    );
    getLogger().error(
      `   Ensure NEAT-AI-Discovery Rust library is properly built and available.`,
    );
    return [];
  }

  private fallbackViableNeuronsFromRecordedErrors(
    targetCount?: number,
  ): NeuronErrorInfo[] {
    const results: NeuronErrorInfo[] = [];
    for (const neuron of this.creature.neurons) {
      if (!this.isSelectableNeuron(neuron as { type: string })) {
        continue;
      }
      const totalError = this.recordedNeuronTotalAbsError.get(neuron.uuid) ?? 0;
      const impact = this.calculateNeuronImpact(neuron.uuid);
      results.push({
        uuid: neuron.uuid,
        totalError: Number.isFinite(totalError) ? totalError : 0,
        impact: Number.isFinite(impact) ? impact : 0,
      });
    }
    results.sort((a, b) => b.totalError - a.totalError);
    if (targetCount && results.length > targetCount) {
      return results.slice(0, targetCount);
    }
    return results;
  }

  private tryRustFocusRanking(
    targetCount?: number,
  ): NeuronErrorInfo[] | undefined {
    if (
      !this.parquetFilePath ||
      !this.deps.rankFocusNeurons ||
      !this.deps.isRustDiscoveryEnabled()
    ) {
      return undefined;
    }

    try {
      const rustCreature = creatureToRustFormat(this.creature.exportJSON());
      const maxResults = Math.max(
        targetCount ?? this.creature.neurons.length,
        64,
      );

      // Get parquet file size for diagnostics
      let parquetFileSize = 0;
      let parquetFileSizeStr = "unknown";
      try {
        const fileInfo = Deno.statSync(this.parquetFilePath);
        parquetFileSize = fileInfo.size;
        const mb = (parquetFileSize / (1024 * 1024)).toFixed(2);
        parquetFileSizeStr =
          `${mb} MB (${parquetFileSize.toLocaleString()} bytes)`;
      } catch {
        // File might not exist or be accessible, ignore
      }

      const nonInputNeurons = this.creature.neurons.filter(
        (n) => n.type !== "input",
      ).length;
      const totalNeurons = this.creature.neurons.length;
      const totalSynapses = this.creature.synapses.length;

      if (this.loggingEnabled) {
        this.log(
          "debug",
          `Rust focus ranking: ${nonInputNeurons} non-input neurons, ${totalNeurons} total neurons, ${totalSynapses} synapses, parquet file: ${parquetFileSizeStr}`,
        );
      }

      const rustRankStart = Date.now();
      const result = this.deps.rankFocusNeurons({
        parquetFile: this.parquetFilePath,
        creature: rustCreature,
        maxResults,
      });
      const rustRankDuration = Date.now() - rustRankStart;

      if (!result || !result.success || !result.neurons) {
        if (this.loggingEnabled && result?.error) {
          this.log(
            "debug",
            `Rust focus ranking failed after ${
              this.formatMillis(rustRankDuration)
            }: ${result.error}`,
          );
        }
        return undefined;
      }

      if (result.maxOutputError !== undefined) {
        this.cachedMaxOutputError = {
          value: result.maxOutputError,
          computedAt: Date.now(),
        };
      }

      this.lastNeuronScanStats = {
        processed: result.processedNeurons ?? result.neurons.length,
        total: result.totalNeurons ?? this.creature.neurons.length,
        durationMs: result.durationMs ?? 0,
        timedOut: false,
      };

      if (this.loggingEnabled) {
        const duration = result.durationMs !== undefined
          ? this.formatMillis(result.durationMs)
          : "unknown time";
        const scannedInfo = result.processedNeurons !== undefined &&
            result.totalNeurons !== undefined
          ? ` Scanned ${result.processedNeurons}/${result.totalNeurons} neurons.`
          : "";
        this.log(
          "debug",
          `Rust focus ranking returned ${result.neurons.length} neuron(s) in ${duration}.${scannedInfo}`,
        );
      }

      // Capture low-impact removal candidates from Rust
      if (result.removalCandidates && result.removalCandidates.length > 0) {
        this.cachedRemovalCandidates = result.removalCandidates.map(
          fromRustRemovalCandidate,
        );
        if (this.loggingEnabled) {
          this.log(
            "info",
            `Found ${result.removalCandidates.length} removal candidate${
              result.removalCandidates.length === 1 ? "" : "s"
            } (impact below costOfGrowth)`,
          );
        }
      }

      return result.neurons.map((entry) => ({
        uuid: entry.neuronUuid,
        totalError: entry.totalError,
        impact: entry.impact,
      }));
    } catch (error) {
      if (this.loggingEnabled) {
        const message = error instanceof Error ? error.message : String(error);
        this.log("debug", `Rust focus ranking threw error: ${message}`);
      }
      return undefined;
    }
  }

  /**
   * Selects a neuron randomly, weighted by total error × impact, favoring neurons with higher
   * error and greater influence on outputs. Implements "roulette wheel" selection.
   *
   * Impact measures how much a neuron affects outputs through its outgoing synapse weights.
   *
   * **Two selection modes:**
   * - **"add"** (default): Selects neurons with high `potentialErrorReduction - costOfGrowth`
   *   for adding synapses/neurons or changing squash functions. Only considers neurons where
   *   potentialErrorReduction >= costOfGrowth (can actually improve score).
   * - **"remove"**: Selects neurons with low impact (impact < costOfGrowth) where removing
   *   the neuron/synapse would improve score by saving the cost of growth.
   *
   * Uses squared weighting: if neuron A has 10x the potential of neuron B, it gets 100x the weight.
   * Weighting is always relative to costOfGrowth to ensure only viable improvements are selected.
   *
   * Reference:
   * - Goldberg, D. E. (1989). Genetic Algorithms in Search, Optimization and Machine Learning.
   *
   * @param count Number of neurons to select
   * @param costOfGrowth Cost threshold for filtering and weighting (from NEAT options, REQUIRED)
   * @param retryNumber Optional retry number for file naming (used in retry loops)
   * @param mode Selection mode: "add" for adding structures, "remove" for removing structures
   */
  public async selectNeuronsWeightedByError(
    count: number,
    costOfGrowth: number,
    retryNumber?: number,
    mode: "add" | "remove" = "add",
  ): Promise<string[]> {
    assert(count > 0, "Count must be greater than 0");
    this.lastFocusSelection = undefined;
    if (
      this.forcedFocusNeurons && this.forcedFocusIndex <
        this.forcedFocusNeurons.length
    ) {
      const nextIndex = Math.min(
        this.forcedFocusIndex + count,
        this.forcedFocusNeurons.length,
      );
      const trimmed = this.forcedFocusNeurons.slice(
        this.forcedFocusIndex,
        nextIndex,
      );
      this.forcedFocusIndex = nextIndex;
      if (this.loggingEnabled) {
        this.log(
          "info",
          `Serving ${trimmed.length} forced focus neuron(s) (${this.forcedFocusIndex}/${this.forcedFocusNeurons.length} consumed).`,
        );
      }
      if (this.forcedFocusIndex >= this.forcedFocusNeurons.length) {
        if (this.loggingEnabled) {
          this.log(
            "info",
            "All forced focus neurons evaluated; falling back to weighted selection.",
          );
        }
        this.forcedFocusNeurons = null;
      }
      if (trimmed.length > 0) {
        this.updateFocusSelectionSummary(
          "forced",
          trimmed,
          undefined,
          undefined,
          "forced focus override",
        );
        // Note: For forced focus, we don't have neuronErrors yet, so skip JSON write
        return trimmed;
      }
    }
    const listViableStart = Date.now();
    const allNeuronErrors = this.listViableNeurons(count);
    const listViableTime = Date.now() - listViableStart;
    if (allNeuronErrors.length === 0) return [];

    // Filter neurons based on mode:
    // - "add" mode: Only neurons where potentialErrorReduction >= costOfGrowth (can improve score by adding)
    // - "remove" mode: Only neurons where impact < costOfGrowth (can improve score by removing)
    const neuronErrors = mode === "add"
      ? allNeuronErrors.filter((n) => {
        const potentialErrorReduction = n.totalError * n.impact;
        return potentialErrorReduction >= costOfGrowth;
      })
      : allNeuronErrors.filter((n) => n.impact < costOfGrowth);

    if (this.loggingEnabled && neuronErrors.length < allNeuronErrors.length) {
      const filtered = allNeuronErrors.length - neuronErrors.length;
      const criteria = mode === "add"
        ? `potentialErrorReduction < costOfGrowth`
        : `impact >= costOfGrowth`;
      this.log(
        "debug",
        `Filtered ${filtered} neurons (${criteria}) for ${mode} mode, costOfGrowth=${costOfGrowth}`,
      );
    }

    if (neuronErrors.length === 0) {
      const reason = mode === "add"
        ? `potentialErrorReduction below costOfGrowth`
        : `impact >= costOfGrowth`;
      this.log(
        "warn",
        `All ${allNeuronErrors.length} neurons have ${reason} (${costOfGrowth}). No viable neurons for ${mode} mode.`,
      );
      return [];
    }

    const maxErrorStart = Date.now();
    const maxOutputError = await this.getMaxOutputError();
    const maxErrorTime = Date.now() - maxErrorStart;
    const hasOutputCap = maxOutputError > 0;

    // EPSILON is set to costOfGrowth - the minimum meaningful improvement
    // This represents the cost of adding a single synapse
    const EPSILON = costOfGrowth;

    // Use squared weighting relative to costOfGrowth to strongly favour viable improvements
    //
    // For "add" mode:
    //   netImprovement = potentialErrorReduction - costOfGrowth
    //   weight = max(netImprovement, EPSILON)^2
    //   This ensures only neurons that can actually improve score get selected
    //
    // For "remove" mode:
    //   netImprovement = costOfGrowth - impact
    //   weight = max(netImprovement, EPSILON)^2
    //   This favours removing neurons with minimal impact to save the cost of growth
    //
    // Example: if neuron A has 10x the net improvement of neuron B, it gets 100x the weight
    const rawWeights = neuronErrors.map((n) => {
      const potentialErrorReduction = n.totalError * n.impact;
      const netImprovement = mode === "add"
        ? potentialErrorReduction - costOfGrowth
        : costOfGrowth - n.impact;

      // Clamp to EPSILON to prevent zero/negative weights (should not happen due to filtering)
      const clampedImprovement = Math.max(netImprovement, EPSILON);

      return {
        uuid: n.uuid,
        raw: clampedImprovement * clampedImprovement, // Square for strong weighting
      };
    });
    const rawSum = rawWeights.reduce((sum, entry) => sum + entry.raw, 0);
    const capTotal = hasOutputCap
      ? Math.max(maxOutputError, EPSILON)
      : rawSum || EPSILON;
    const scale = hasOutputCap && rawSum > capTotal && rawSum > EPSILON
      ? capTotal / rawSum
      : 1;
    if (scale < 0.9999) {
      const scaleLabel = scale < 0.0001
        ? scale.toExponential(2)
        : scale.toFixed(4);
      this.log(
        "debug",
        `Scaling weighted errors by ${scaleLabel} to respect output error cap ${
          maxOutputError.toFixed(4)
        }`,
      );
    }
    const weightedValues = rawWeights.map((entry) => ({
      uuid: entry.uuid,
      weight: entry.raw * scale,
    }));
    const totalWeightedSum = weightedValues.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );
    const weightMapAll = new Map(
      weightedValues.map((entry) => [entry.uuid, entry.weight]),
    );

    if (neuronErrors.length <= count) {
      const uuids = neuronErrors.map((neuron) => neuron.uuid);
      this.updateFocusSelectionSummary(
        "all",
        uuids,
        weightMapAll,
        totalWeightedSum,
        "all viable neurons selected",
      );
      const selectedSet = new Set(uuids);
      this.writeFocusSelectionAnalysis(
        neuronErrors,
        selectedSet,
        totalWeightedSum,
        "all",
        costOfGrowth,
        retryNumber,
      );
      return uuids;
    }
    const selectedUUIDs: Set<string> = new Set();

    // Guard against NaN, Infinity, or zero total weighted sum
    if (!Number.isFinite(totalWeightedSum)) {
      getLogger().error(
        `❌ CRITICAL ERROR: totalWeightedSum is ${totalWeightedSum} (NaN or Infinity). This indicates corrupt error/impact calculations in the discovery process!`,
      );
      getLogger().error(
        `   Neuron weighted summary: ${
          weightedValues.slice(0, 5).map((n) =>
            `${n.uuid.slice(-8)}: weight=${n.weight}`
          ).join(", ")
        }...`,
      );
      // Fallback to random selection to prevent infinite loops
      getLogger().warn(
        `   Falling back to random neuron selection to continue discovery`,
      );
      const shuffled = [...neuronErrors].sort(() => Math.random() - 0.5);
      const fallback = shuffled.slice(0, count).map((n) => n.uuid);
      this.updateFocusSelectionSummary(
        "random",
        fallback,
        undefined,
        undefined,
        "random selection due to invalid total weight",
      );
      const fallbackSet = new Set(fallback);
      this.writeFocusSelectionAnalysis(
        neuronErrors,
        fallbackSet,
        0,
        "random-fallback-nan",
        costOfGrowth,
        retryNumber,
      );
      return fallback;
    }

    if (totalWeightedSum <= 0) {
      getLogger().warn(
        `⚠️  WARNING: totalWeightedSum is ${totalWeightedSum} (zero or negative). All neurons have zero error × impact?`,
      );
      getLogger().warn(`   Falling back to random neuron selection`);
      // Fallback to random selection without weighting
      const shuffled = [...neuronErrors].sort(() => Math.random() - 0.5);
      const fallback = shuffled.slice(0, count).map((n) => n.uuid);
      this.updateFocusSelectionSummary(
        "random",
        fallback,
        undefined,
        undefined,
        "random selection due to zero total weight",
      );
      const fallbackSet = new Set(fallback);
      this.writeFocusSelectionAnalysis(
        neuronErrors,
        fallbackSet,
        0,
        "random-fallback-zero",
        costOfGrowth,
        retryNumber,
      );
      return fallback;
    }

    // Use while loop with max iterations to prevent infinite loops
    // With skewed distributions, we may repeatedly select the same neuron
    // Track stalls and switch to fallback if we're not making progress
    // Base max iterations on the smaller of count or neuronErrors.length
    const maxIterations = Math.min(count, neuronErrors.length) * 100;
    let iterations = 0;
    let stallCount = 0;
    let lastSize = 0;

    // Stall threshold: be aggressive when we have few neurons
    const stallThreshold = Math.min(neuronErrors.length * 3, count * 5);

    while (selectedUUIDs.size < count && iterations < maxIterations) {
      iterations++;
      const randValue = Math.random() * totalWeightedSum;
      let cumulativeWeight = 0;

      for (const weighted of weightedValues) {
        cumulativeWeight += weighted.weight;
        if (randValue <= cumulativeWeight) {
          selectedUUIDs.add(weighted.uuid);
          break;
        }
      }

      // Detect if we're stalling (not selecting new neurons)
      if (selectedUUIDs.size === lastSize) {
        stallCount++;
        // If we've stalled for too long, switch to hybrid approach
        if (stallCount > stallThreshold) {
          // Fill remaining slots with random selection from unselected neurons
          const unselected = neuronErrors
            .filter((n) => !selectedUUIDs.has(n.uuid))
            .sort(() => Math.random() - 0.5);
          const needed = count - selectedUUIDs.size;
          unselected.slice(0, needed).forEach((n) => selectedUUIDs.add(n.uuid));
          break;
        }
      } else {
        stallCount = 0;
        lastSize = selectedUUIDs.size;
      }
    }

    if (iterations >= maxIterations) {
      getLogger().error(
        `❌ ERROR: Selection reached max iterations (${maxIterations}), only selected ${selectedUUIDs.size}/${count} neurons`,
      );
      getLogger().error(
        `   This should not happen with the hybrid approach. Please report this.`,
      );
      getLogger().error(
        `   totalWeightedSum: ${totalWeightedSum}, neuronErrors.length: ${neuronErrors.length}`,
      );
    }

    const selection = Array.from(selectedUUIDs);
    const weightMap = new Map(
      weightedValues.map((n) => [n.uuid, n.weight]),
    );
    this.updateFocusSelectionSummary(
      "weighted",
      selection,
      weightMap,
      totalWeightedSum,
      "error x impact weighting",
    );
    this.writeFocusSelectionAnalysis(
      neuronErrors,
      selectedUUIDs,
      totalWeightedSum,
      "weighted",
      costOfGrowth,
      retryNumber,
    );

    // Log timing breakdown if either phase took significant time
    if (this.loggingEnabled && (listViableTime > 100 || maxErrorTime > 100)) {
      this.log(
        "debug",
        `Focus selection breakdown: listViableNeurons=${
          this.formatMillis(listViableTime)
        }, maxOutputError=${this.formatMillis(maxErrorTime)}`,
      );
    }

    return selection;
  }

  /**
   * Entry point for automatic synapse pruning using error-driven analysis.
   * Selects low-impact neurons and evaluates their incoming synapses for removal.
   *
   * @param discoveryMaxNeurons - Number of neurons to consider, weighted by error magnitude.
   * @param costOfGrowth - Cost threshold from NEAT options (neurons with impact < costOfGrowth are candidates for removal)
   * @returns A modified Creature with harmful synapse(s) removed, or null if no change was needed.
   */
  async analyzeSynapsesForRemoval(
    discoveryMaxNeurons: number,
    costOfGrowth: number,
  ): Promise<CandidateSynapse | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
      costOfGrowth,
      undefined, // retryNumber
      "remove", // Select neurons with low impact for removal
    );
    return this.analyzeSelectedNeuronsForRemoval(focusList);
  }

  /**
   * Randomly selects a neuron and evaluates its activation function to identify squash function modifications.
   *
   * @param discoveryMaxNeurons - Number of neurons to consider, weighted by error magnitude.
   * @param costOfGrowth - Cost threshold from NEAT options for filtering viable neurons
   * @returns CandidateNeurons with the most promising squash functions modifications.
   */
  async analyzeNeuronsSquashes(
    discoveryMaxNeurons: number,
    costOfGrowth: number,
  ): Promise<CandidateSquash[] | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
      costOfGrowth,
    );
    return this.analyzeSelectedNeuronsSquashes(focusList);
  }

  public async analyzeSelectedNeuronsSquashes(
    focusList: string[],
  ): Promise<CandidateSquash[] | undefined> {
    if (focusList.length === 0) return undefined;

    // Check timeout before starting analysis
    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsSquashes",
      );
      this.logAnalysisSkipped("neuron");
      this.logFocusSelectionDetails("neuron", focusList);
      return undefined;
    }

    const candidatePromises = focusList.map(async (neuronUUID) => {
      const records = await this.loadNeuronRecords(
        `${this.tempDir}/${neuronUUID}`,
      );
      return this.findCandidateSquash(neuronUUID, records);
    });

    return await Promise.all(candidatePromises).then((candidates) => {
      return candidates.filter((candidate) => candidate !== undefined);
    });
  }

  private calculateSquashError(
    idealActivations: number[],
    actualActivations: number[],
  ) {
    const mse = new MSE();
    let totalError = 0;
    for (let i = 0; i < idealActivations.length; i++) {
      const idealActivation = idealActivations[i];
      const actualActivation = actualActivations[i];
      if (actualActivation === undefined) {
        throw new Error("Activation is undefined");
      }
      const error = mse.calculate(
        Float32Array.from([idealActivation]),
        Float32Array.from([actualActivation]),
      );
      totalError += error;
    }

    return totalError / idealActivations.length;
  }

  private findCandidateSquash(
    neuronUUID: string,
    records: DiscoverRecord[],
  ): CandidateSquash | undefined {
    const rawValues: number[] = [];
    const currentActivations: number[] = [];
    const idealActivations: number[] = [];
    const neuronErrors: number[] = [];

    const neuron = this.creature.neurons.find((neuron) =>
      neuron.uuid === neuronUUID
    )!;
    const currentSquash = neuron.squash;
    assert(currentSquash, "Squash function not found");
    const currentSquashMethod = Activations.find(
      currentSquash,
    ) as ActivationInterface;

    records.forEach((record) => {
      const value = record.value;
      if (value === undefined) {
        throw new Error("Value is undefined");
      }
      rawValues.push(value);
      const activation = record.activation;
      if (activation === undefined) {
        throw new Error("Activation is undefined");
      }
      currentActivations.push(activation);
      const errors = record.errors;
      const finiteErrors = errors.filter(Number.isFinite);
      const avgError = finiteErrors.length
        ? finiteErrors.reduce((a, b) => a + b, 0) / finiteErrors.length
        : 0;
      neuronErrors.push(avgError);

      const idealValue = value + avgError;
      const idealActivation = currentSquashMethod.squash(idealValue);
      idealActivations.push(idealActivation);
    });

    // Calculate baseline activation error (for comparison)
    const baselineActivationError = this.calculateSquashError(
      idealActivations,
      currentActivations,
    );

    // Use activation error for finding best squash, but we'll scale the improvement estimate
    // based on error magnitude to get a more realistic network-level estimate
    const baselineError = baselineActivationError;

    // SANITY CHECK: Filter out neurons with astronomically high errors
    // If a neuron has errors of 1E+10 or higher, changing its activation function
    // won't help - the neuron is fundamentally broken and should be removed instead.
    // Such errors typically indicate:
    // 1. Accumulated errors from multiple paths that have grown unbounded
    // 2. A neuron that is disconnected or has incorrect connections
    // 3. Numerical instability in the error calculation
    const MAX_REASONABLE_SQUASH_ERROR = 1e10; // Threshold for reasonable error magnitude
    if (baselineError > MAX_REASONABLE_SQUASH_ERROR) {
      if (this.loggingEnabled) {
        this.log(
          "warn",
          `Skipping squash analysis for neuron ${neuronUUID}: error magnitude (${
            baselineError.toExponential(2)
          }) exceeds reasonable threshold (${
            MAX_REASONABLE_SQUASH_ERROR.toExponential(2)
          }). ` +
            `This neuron should be removed rather than having its activation function changed.`,
        );
      }
      // Clear arrays to help GC
      rawValues.length = 0;
      currentActivations.length = 0;
      idealActivations.length = 0;
      neuronErrors.length = 0;
      // Return undefined for squash candidate, but the caller should check for harmful neurons separately
      return undefined;
    }

    let lowestError = baselineError;
    let bestSquash = currentSquash;
    let bestSquashFunction: ActivationInterface | undefined = undefined;

    const squashFunctions: ActivationInterface[] = Activations.list().filter(
      (activation) => {
        return (activation as ActivationInterface).squash !== undefined;
      },
    ) as ActivationInterface[];

    // Randomize the order of the squash functions using Fisher-Yates shuffle
    for (let i = squashFunctions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [squashFunctions[i], squashFunctions[j]] = [
        squashFunctions[j],
        squashFunctions[i],
      ];
    }

    for (const squashFunction of squashFunctions) {
      const tempActivations = rawValues.map((value) => {
        return squashFunction.squash(value);
      });
      const newError = this.calculateSquashError(
        idealActivations,
        tempActivations,
      );

      if (newError < lowestError - 0.0001) {
        lowestError = newError;
        bestSquash = squashFunction.getName();
        bestSquashFunction = squashFunction;
      }
    }

    if (bestSquash !== currentSquash) {
      // Calculate activation-based improvement
      const rawActivationImprovement = baselineError > 0
        ? (baselineError - lowestError) / baselineError
        : 0;

      // Apply a conservative scaling factor that increases with sample count
      // With more samples, we can be more confident in the estimate
      const sampleCount = records.length;
      // Scale factor: 0.1 for < 1000 samples, up to 0.5 for >= 40000 samples
      const conservativeScale = Math.min(
        0.5,
        Math.max(0.1, 0.1 + (sampleCount / 40000) * 0.4),
      );

      // Estimate network-level improvement using error-based approach
      // Calculate how much the activation change would reduce neuron-level errors
      // Use the stored function object if available, otherwise try to find it
      let rawImprovement: number; // Unscaled improvement for threshold check
      let scaledImprovement: number; // Scaled improvement for final estimate

      try {
        const bestSquashMethod = bestSquashFunction ||
          (Activations.find(bestSquash) as ActivationInterface | undefined);

        if (!bestSquashMethod) {
          // If we can't find the activation (e.g., in test mocks), skip error-based estimation
          // and use only activation-based improvement
          rawImprovement = rawActivationImprovement;
          scaledImprovement = rawActivationImprovement * conservativeScale;
        } else {
          let errorImprovementSum = 0;
          let errorImprovementCount = 0;
          let absoluteErrorSum = 0;

          for (let i = 0; i < records.length; i++) {
            const value = rawValues[i];
            const currentActivation = currentActivations[i];
            const newActivation = bestSquashMethod.squash(value);
            const idealActivation = idealActivations[i];
            const error = neuronErrors[i];

            // Calculate how much closer the new activation is to ideal
            const currentDist = Math.abs(currentActivation - idealActivation);
            const newDist = Math.abs(newActivation - idealActivation);

            if (currentDist > 1e-10 && Number.isFinite(error) && error !== 0) {
              // Improvement ratio: how much closer we got to ideal
              const improvementRatio = (currentDist - newDist) / currentDist;
              // Scale by error magnitude to estimate network-level impact
              // Use absolute error to get magnitude
              const errorMagnitude = Math.abs(error);
              const estimatedImprovement = improvementRatio * errorMagnitude;
              errorImprovementSum += estimatedImprovement;
              absoluteErrorSum += errorMagnitude;
              errorImprovementCount++;
            }
          }

          // Calculate error-based improvement percentage
          const avgErrorImprovement = errorImprovementCount > 0
            ? errorImprovementSum / errorImprovementCount
            : 0;
          // Calculate mean absolute error for percentage calculation
          // Only use errors from records that passed the condition to match the numerator
          const meanAbsoluteError = errorImprovementCount > 0
            ? absoluteErrorSum / errorImprovementCount
            : 0;
          const errorBasedImprovement = meanAbsoluteError > 0
            ? avgErrorImprovement / meanAbsoluteError
            : 0;

          // Use the more conservative estimate: take minimum of activation-based
          // and error-based for the unscaled value (for threshold check)
          rawImprovement = Math.min(
            rawActivationImprovement,
            errorBasedImprovement,
          );
          // Apply conservative scaling for the final estimate
          scaledImprovement = rawImprovement * conservativeScale;
        }
      } catch (_error) {
        // If activation lookup fails (e.g., unknown activation in test mocks),
        // fall back to activation-based improvement only
        rawImprovement = rawActivationImprovement;
        scaledImprovement = rawActivationImprovement * conservativeScale;
      }

      // Compute average derivative from records to account for saturation
      let derivativeSum = 0;
      let derivativeCount = 0;
      const sampleSize = Math.min(records.length, 50);
      const step = Math.max(1, Math.floor(records.length / sampleSize));

      for (let i = 0; i < records.length; i += step) {
        const val = records[i].value;
        if (Number.isFinite(val)) {
          const eps = 1e-4;
          const y1 = currentSquashMethod.squash(val as number);
          const y2 = currentSquashMethod.squash((val as number) + eps);
          const derivative = (y2 - y1) / eps;
          if (Number.isFinite(derivative)) {
            derivativeSum += Math.abs(derivative);
            derivativeCount++;
          }
        }
        if (derivativeCount >= sampleSize) break;
      }

      const avgDerivative = derivativeCount > 0
        ? derivativeSum / derivativeCount
        : 1.0;

      // Create derivativeMap with this neuron's average derivative
      const derivativeMap = new Map<string, number>();
      derivativeMap.set(neuronUUID, avgDerivative);

      // Scale by neuron's impact on output to avoid inflated expectations
      const neuronImpact = this.calculateNeuronImpact(
        neuronUUID,
        derivativeMap,
      );
      const impactScale = Number.isFinite(neuronImpact)
        ? Math.min(Math.max(neuronImpact, 0), 1)
        : 1.0; // Default to 1.0 if impact can't be calculated

      const expectedCreatureScoreGain = scaledImprovement * impactScale;

      // Accept any positive improvement (no threshold filtering)
      if (rawImprovement > 0) {
        // Clear large arrays to help GC (after we've used them for improvement calculation)
        rawValues.length = 0;
        currentActivations.length = 0;
        idealActivations.length = 0;
        neuronErrors.length = 0;

        return {
          neuronUUID,
          previousSquash: currentSquash,
          squash: bestSquash,
          expectedCreatureScoreGain: expectedCreatureScoreGain,
          improvedError: lowestError,
          currentError: baselineError,
        };
      }
    }

    // Clear large arrays to help GC
    rawValues.length = 0;
    currentActivations.length = 0;
    idealActivations.length = 0;
    neuronErrors.length = 0;

    return undefined;
  }

  /** Delegates to the extracted validateAndFixIfNeeded function. */
  private static validateAndFixIfNeeded(
    creature: Creature,
    originalCreature: Creature,
    discoveryID: string,
    operationType: string,
    candidate: unknown,
    discoveryFailureCacheDir?: string,
  ): { success: boolean; fixWasCalled: boolean; validationError?: Error } {
    return validateAndFixIfNeededImpl(
      creature,
      originalCreature,
      discoveryID,
      operationType,
      candidate,
      discoveryFailureCacheDir,
    );
  }

  /** Delegates to the extracted recordDiscoveryIssue function. */
  private static recordDiscoveryIssue(
    originalCreature: Creature,
    discoveryID: string,
    operationType: string,
    issueType: string,
    details: unknown,
    discoveryFailureCacheDir: string,
  ): void {
    recordDiscoveryIssueImpl(
      originalCreature,
      discoveryID,
      operationType,
      issueType,
      details,
      discoveryFailureCacheDir,
    );
  }

  /** Delegates to the extracted removeSynapse function. */
  public static removeSynapse(
    ID: string,
    creature: Creature,
    worseCandidate?: CandidateSynapse,
    discoveryFailureCacheDir?: string,
  ): Creature | null {
    return removeSynapseImpl(
      ID,
      creature,
      worseCandidate,
      discoveryFailureCacheDir,
    );
  }

  /** Delegates to the extracted addHelpfulSynapses function. */
  public static addHelpfulSynapses(
    ID: string,
    creature: Creature,
    helpfulSynapses?: CandidateSynapse[],
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return addHelpfulSynapsesImpl(
      ID,
      creature,
      helpfulSynapses,
      discoveryFailureCacheDir,
    );
  }

  /** Delegates to the extracted addHelpfulNeurons function. */
  public static addHelpfulNeurons(
    ID: string,
    creature: Creature,
    helpfulNeurons?: CandidateNeuron[],
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return addHelpfulNeuronsImpl(
      ID,
      creature,
      helpfulNeurons,
      discoveryFailureCacheDir,
    );
  }

  /** Delegates to the extracted changeSquash function. */
  public static changeSquash(
    ID: string,
    creature: Creature,
    helpfulSquashes?: CandidateSquash[],
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return changeSquashImpl(
      ID,
      creature,
      helpfulSquashes,
      discoveryFailureCacheDir,
    );
  }

  /**
   * Evaluates all incoming synapses to a set of high-error neurons to identify
   * connections that consistently worsen prediction error.
   *
   * This method considers an existing synapse harmful if its signal correlates
   * with the error direction more often than not.
   *
   * @param focusList - Array of neuron UUIDs to evaluate for synapse pruning.
   * @returns A modified Creature with the worst offending synapse removed, or null if none found.
   */
  public analyzeSelectedNeuronsForRemoval(
    focusList: string[],
  ): Promise<CandidateSynapse | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsForRemoval",
      );
      this.logAnalysisSkipped("synapse");
      this.logFocusSelectionDetails("synapse", focusList);
      return Promise.resolve(undefined);
    }

    if (!this.parquetFilePath || !this.deps.isRustDiscoveryEnabled()) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "Rust discovery unavailable",
      );
      return Promise.resolve(undefined);
    }

    // Populate the cache before reading from it
    this.ensureRustCombinedAnalysis(focusList, true, false);

    const rustCandidates = this.tryRustHarmfulCandidates(focusList);
    if (!rustCandidates) {
      this.logRustAnalysisUnavailable(
        "synapse",
        focusList,
        "analysis did not return a result",
      );
      return Promise.resolve(undefined);
    }
    if (rustCandidates.length === 0) {
      return Promise.resolve(undefined);
    }

    const worstCandidate = rustCandidates[0];
    this.logHarmfulSynapse(worstCandidate);
    return Promise.resolve(worstCandidate);
  }

  /**
   * Analyzes selected neurons to identify those with extremely high errors that should be removed.
   * Neurons with errors exceeding MAX_REASONABLE_SQUASH_ERROR (1e10) are considered harmful
   * and should be removed rather than having their activation functions changed.
   *
   * @param focusList - List of neuron UUIDs to analyze
   * @returns Array of harmful neuron candidates, or undefined if none found
   */
  public async analyzeSelectedNeuronsForHarmfulRemoval(
    focusList: string[],
  ): Promise<CandidateHarmfulNeuron[] | undefined> {
    if (focusList.length === 0) return undefined;

    // Check timeout before starting analysis
    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsForHarmfulRemoval",
      );
      this.logAnalysisSkipped("neuron");
      this.logFocusSelectionDetails("neuron", focusList);
      return undefined;
    }

    const MAX_REASONABLE_SQUASH_ERROR = 1e10; // Threshold for reasonable error magnitude

    const candidatePromises = focusList.map(async (neuronUUID) => {
      try {
        const records = await this.loadNeuronRecords(
          `${this.tempDir}/${neuronUUID}`,
        );
        if (!records || records.length === 0) return undefined;

        // Calculate baseline error similar to findCandidateSquash
        const rawValues: number[] = [];
        const currentActivations: number[] = [];
        const idealActivations: number[] = [];

        const neuron = this.creature.neurons.find((neuron) =>
          neuron.uuid === neuronUUID
        );
        if (!neuron) return undefined;

        const currentSquash = neuron.squash;
        if (!currentSquash) return undefined;

        const currentSquashMethod = Activations.find(
          currentSquash,
        ) as ActivationInterface;
        if (!currentSquashMethod) return undefined;

        let activationSum = 0;
        let activationCount = 0;

        records.forEach((record) => {
          const value = record.value;
          if (value === undefined) return;
          rawValues.push(value);
          const activation = record.activation;
          if (activation === undefined) return;
          currentActivations.push(activation);

          // Calculate average activation for efficient bias adjustment
          if (Number.isFinite(activation)) {
            activationSum += activation;
            activationCount++;
          }

          const errors = record.errors;
          const finiteErrors = errors.filter(Number.isFinite);
          const avgError = finiteErrors.length
            ? finiteErrors.reduce((a, b) => a + b, 0) / finiteErrors.length
            : 0;

          const idealValue = value + avgError;
          const idealActivation = currentSquashMethod.squash(idealValue);
          idealActivations.push(idealActivation);
        });

        if (idealActivations.length === 0) return undefined;

        // Calculate average activation across all samples
        const averageActivation = activationCount > 0
          ? activationSum / activationCount
          : 0;

        // Calculate baseline activation error
        const baselineActivationError = this.calculateSquashError(
          idealActivations,
          currentActivations,
        );

        // Check if error exceeds threshold
        if (baselineActivationError > MAX_REASONABLE_SQUASH_ERROR) {
          // Calculate expected improvement from removal
          // Removing a neuron with extremely high errors should provide significant improvement
          // Estimate improvement as a percentage based on error magnitude
          // Higher errors = higher expected improvement (capped at reasonable values)
          const errorLog = Math.log10(baselineActivationError);
          const thresholdLog = Math.log10(MAX_REASONABLE_SQUASH_ERROR);
          const excessMagnitude = errorLog - thresholdLog;
          // Scale improvement estimate: 0.1 (10%) for just over threshold, up to 0.5 (50%) for very high errors
          const expectedCreatureScoreGain = Math.min(
            0.5,
            Math.max(0.1, 0.1 + (excessMagnitude / 10) * 0.4),
          );

          return {
            neuronUUID,
            errorMagnitude: baselineActivationError,
            expectedCreatureScoreGain: expectedCreatureScoreGain,
            sampleCount: records.length,
            averageActivation,
          };
        }

        return undefined;
      } catch (error) {
        if (this.loggingEnabled) {
          this.log(
            "error",
            `Error analyzing neuron ${neuronUUID} for harmful removal: ${error}`,
          );
        }
        return undefined;
      }
    });

    const results = await Promise.all(candidatePromises);
    const candidates = results.filter(
      (candidate) => candidate !== undefined,
    ) as CandidateHarmfulNeuron[];

    if (candidates.length === 0) return undefined;

    // Sort by error magnitude (highest first) and expected improvement
    candidates.sort((a, b) => {
      // Primary sort: by error magnitude (descending)
      if (Math.abs(b.errorMagnitude - a.errorMagnitude) > 1e-6) {
        return b.errorMagnitude - a.errorMagnitude;
      }
      // Secondary sort: by expected creature score gain (descending)
      return b.expectedCreatureScoreGain - a.expectedCreatureScoreGain;
    });

    if (this.loggingEnabled && candidates.length > 0) {
      this.log(
        "info",
        `Found ${candidates.length} harmful neuron candidate(s) with extremely high errors`,
      );
      candidates.slice(0, 5).forEach((candidate) => {
        this.log(
          "info",
          `  - ${candidate.neuronUUID}: error=${
            candidate.errorMagnitude.toExponential(2)
          }, expected creature score gain=${
            (candidate.expectedCreatureScoreGain * 100).toFixed(1)
          }%`,
        );
      });
    }

    return candidates;
  }

  /** Delegates to the extracted removeHarmfulNeuron function. */
  public static removeHarmfulNeuron(
    ID: string,
    creature: Creature,
    harmfulNeuron?: CandidateHarmfulNeuron,
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return removeHarmfulNeuronImpl(
      ID,
      creature,
      harmfulNeuron,
      discoveryFailureCacheDir,
    );
  }

  /** Delegates to the extracted removeLowImpactNeuron function. */
  public static removeLowImpactNeuron(
    ID: string,
    creature: Creature,
    removalCandidate?: import("./DiscoverResult.ts").RemovalCandidate,
    discoveryFailureCacheDir?: string,
  ): Creature | undefined {
    return removeLowImpactNeuronImpl(
      ID,
      creature,
      removalCandidate,
      discoveryFailureCacheDir,
    );
  }

  /** Reset removal diagnostics (call at start of discovery to get fresh stats). */
  public static resetRemovalDiagnostics(): void {
    resetRemovalDiagnosticsImpl();
  }

  /** Get count of removals that failed due to same UUID. */
  public static getRemovalSameUUIDCount(): number {
    return getRemovalSameUUIDCountImpl();
  }

  /**
   * Returns low-impact neurons flagged for removal by Rust focus ranking.
   * These neurons have high error but very low impact (< 1% contribution to outputs).
   */
  public getRemovalCandidates():
    | import("./DiscoverResult.ts").RemovalCandidate[]
    | undefined {
    return this.cachedRemovalCandidates;
  }
}
