import { assert } from "@std/assert";
import { parse as parseCsv } from "@std/csv";
import { addTag, removeTag, type TagsInterface } from "@stsoftware/tags/mod";
import { CreatureUtil } from "../../../mod.ts";
import { Creature } from "../../Creature.ts";
import type { Approach } from "../../NEAT/LogApproach.ts";
import { memeticUpdate } from "../../blackbox/MemeticUpdate.ts";
import { MSE } from "../../costs/MSE.ts";
import type { ActivationInterface } from "../../methods/activations/ActivationInterface.ts";
import { Activations } from "../../methods/activations/Activations.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import {
  analyzeAll,
  analyzeNeurons,
  analyzeParallel,
  analyzeSynapses,
  creatureToRustFormat,
  isRustDiscoveryEnabled,
  isRustLibraryAvailable,
  mergeDiscoveryParquet,
  rankFocusNeurons,
  readDiscoveryRecords,
  recordDiscovery,
  type RustAnalyzeAllInput,
  type RustAnalyzeAllResult,
  type RustAnalyzeNeuronsInput,
  type RustAnalyzeNeuronsResult,
  type RustAnalyzeSynapsesInput,
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
import { DEFAULT_RUST_FLUSH_RECORDS } from "./constants.ts";

export { DEFAULT_RUST_FLUSH_RECORDS } from "./constants.ts";

export interface DiscoverStructureDeps {
  isRustDiscoveryEnabled: typeof isRustDiscoveryEnabled;
  isRustLibraryAvailable: typeof isRustLibraryAvailable;
  recordDiscovery: typeof recordDiscovery;
  mergeDiscoveryParquet: typeof mergeDiscoveryParquet;
  analyzeNeurons: typeof analyzeNeurons;
  analyzeSynapses: typeof analyzeSynapses;
  analyzeParallel?: typeof analyzeParallel;
  analyzeAll?: typeof analyzeAll;
  readDiscoveryRecords: typeof readDiscoveryRecords;
  rankFocusNeurons?: typeof rankFocusNeurons;
}

const DEFAULT_DISCOVER_STRUCTURE_DEPS: DiscoverStructureDeps = {
  isRustDiscoveryEnabled,
  isRustLibraryAvailable,
  recordDiscovery,
  mergeDiscoveryParquet,
  analyzeNeurons,
  analyzeSynapses,
  analyzeParallel,
  analyzeAll,
  readDiscoveryRecords,
  rankFocusNeurons,
};

const OUTPUT_ERROR_CACHE_TTL_MS = 30_000;

/**
 * Implements Error-Driven Synapse Discovery, a neuroevolution technique for optimizing neural network structures.
 * This class analyzes neuron activations and back-propagation errors to discover beneficial new synapses
 * that explicitly reduce neuron-level errors.
 *
 * References:
 * - Stanley, K. O., & Miikkulainen, R. (2002). Evolving Neural Networks through Augmenting Topologies (NEAT).
 *   Evolutionary Computation, 10(2), 99–127.
 * - Floreano, D., Dürr, P., & Mattiussi, C. (2008). Neuroevolution: from architectures to learning. Evolutionary Intelligence, 1(1), 47-62.
 */

export interface DiscoverRecord {
  activation: number;
  errors: number[];
  value?: number;
}

/**
 * Tracks which binary file records were selected during discovery.
 * Maps binary file paths to arrays of record indices.
 */
export interface BinaryRecordIndices {
  [binaryFile: string]: number[];
}

/**
 * Represents a potential new synapse and the associated metrics calculated during discovery.
 */
export interface CandidateSynapse {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  weight: number;
  expectedImprovementPercentage: number;
  improvedCount: number;
  totalCount: number;
}

export interface CandidateSquash {
  neuronUUID: string;
  previousSquash: string;
  squash: string;
  expectedImprovementPercentage: number;
  improvedError: number;
  currentError: number;
}

export interface CandidateNeuron {
  fromNeuronUUID: string;
  toNeuronUUID: string;
  incomingWeight: number;
  outgoingWeight: number;
  squash: string;
  bias: number;
  expectedImprovementPercentage: number;
  improvedCount: number;
  totalCount: number;
}

interface CandidateAnalysisBundle {
  helpfulSynapses?: CandidateSynapse[];
  harmfulSynapse?: CandidateSynapse;
  helpfulNeurons?: CandidateNeuron[];
}

type FocusSelectionMode = "weighted" | "forced" | "all" | "random";

interface FocusSelectionSummaryEntry {
  uuid: string;
  weight?: number;
}

interface FocusSelectionSummary {
  key: string;
  mode: FocusSelectionMode;
  reason: string;
  neurons: FocusSelectionSummaryEntry[];
  totalWeight?: number;
}

interface NeuronScanStats {
  processed: number;
  total: number;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Represents a neuron and its total accumulated error for ranking neurons during discovery.
 * Impact measures how much a neuron affects outputs through its outgoing synapse weights.
 */
export interface NeuronErrorInfo {
  uuid: string;
  totalError: number;
  impact: number;
}

interface NeuronImpactInfo {
  uuid: string;
  neuronType: string;
  impact: number;
}

export interface RustFlushMetrics extends RustRecordBatchStats {
  recordsWithNoNeuronData: number;
  recordsWithMismatchedNeuronCount: number;
  recordsWithInputMismatch: number;
  recordsWithOutputMismatch: number;
  missingUuidEntries: number;
  nonFiniteActivationCount: number;
  nonFiniteValueCount: number;
  nonFiniteErrorCount: number;
  firstMissingUuidLocation?: string;
  firstNonFiniteActivationLocation?: string;
  firstNonFiniteValueLocation?: string;
  firstNonFiniteErrorLocation?: string;
}

interface RustFlushDiagnostics {
  summary: string;
  warnings: string[];
  errors: string[];
  metrics: RustFlushMetrics;
}

interface RustFlushAggregation {
  expectedInputLength: number;
  expectedOutputLength: number;
  expectedNeuronCount: number;
  metrics: RustFlushMetrics;
}

const DEFAULT_RUST_HELPFUL_THRESHOLD = 0.1;
const DEFAULT_RUST_HARMFUL_THRESHOLD = -0.1;

/**
 * Implements Error-Driven Synapse Discovery, analyzing neuron activations
 * and errors to identify beneficial new synapses that explicitly reduce neuron-level errors.
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
  private rustBinaryFilePath: string | null = null;
  private rustBinaryFilePaths: Set<string> = new Set(); // Track all binary file paths
  private usingRustDualWrite = false;
  private parquetFilePath: string | null = null;
  private rustFlushRecords: number;
  private rustChunkFiles: string[] = [];
  private rustChunkCounter = 0;
  private syntheticBinaryMode = false;
  private deps: DiscoverStructureDeps;
  private forcedFocusNeurons: string[] | null = null;
  private forcedFocusIndex = 0;
  private improvementThreshold = DEFAULT_RUST_HELPFUL_THRESHOLD;
  private harmfulThreshold = DEFAULT_RUST_HARMFUL_THRESHOLD;
  private lastFocusSelection?: FocusSelectionSummary;
  private cachedMaxOutputError?: { value: number; computedAt: number } =
    undefined;
  private lastNeuronScanStats?: NeuronScanStats;
  private analysisDeadlineMs?: number;
  private combinedRustAnalysis?: {
    key: string;
    includeSynapse: boolean;
    includeNeuron: boolean;
    result: RustAnalyzeAllResult;
  };
  private analysisTimeoutGuardEnabled = true;
  constructor(
    creature: Creature,
    timeoutSeconds: number,
    rustFlushRecords: number = DEFAULT_RUST_FLUSH_RECORDS,
    deps: Partial<DiscoverStructureDeps> = {},
  ) {
    this.creature = creature;
    assert(creature.uuid, "Creature must have a UUID to discover structure.");
    this.tempDir = `.discovery/${creature.uuid}_${
      Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    }`;
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
    this.deps = { ...DEFAULT_DISCOVER_STRUCTURE_DEPS, ...deps };

    Deno.mkdirSync(this.tempDir, { recursive: true });
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
        const records = await this.loadCSV(
          `${this.tempDir}/${outputNeuron.uuid}.csv`,
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

  public setImprovementThreshold(threshold: number): void {
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      if (this.loggingEnabled) {
        this.log(
          "warn",
          `Ignored invalid discovery improvement threshold: ${threshold}`,
        );
      }
      return;
    }
    this.improvementThreshold = parsed;
    this.harmfulThreshold = -Math.abs(parsed);
    if (this.loggingEnabled) {
      this.log(
        "info",
        `Configured discovery improvement threshold to ${
          (this.improvementThreshold * 100).toFixed(2)
        }%.`,
      );
    }
  }

  /**
   * Initializes the discovery process.
   * Requires the NEAT-AI-Discovery Rust library to be available.
   * Discovery will fail gracefully if Rust module is not available.
   */
  public initialize(neuronPromisesMap: Map<string, Promise<void>>) {
    assert(!this.initialized, "Already initialized");
    this.initialized = true;

    // Check if Rust discovery is enabled (requires both library file AND FFI permissions)
    if (!this.deps.isRustDiscoveryEnabled()) {
      console.warn(
        `⚠️  Discovery requires the NEAT-AI-Discovery Rust library and FFI permissions. Discovery will be skipped.`,
      );
      // Set up empty promises - discovery will fail gracefully
      this.creature.neurons.forEach((neuron) => {
        neuronPromisesMap.set(neuron.uuid, Promise.resolve());
      });
      return;
    }

    // Rust discovery is enabled - set up for Rust recording
    this.usingRustDualWrite = true;

    // Set up promise placeholders for all neurons (Rust handles file creation)
    this.creature.neurons.forEach((neuron) => {
      neuronPromisesMap.set(neuron.uuid, Promise.resolve());
    });

    // Initialize the indices file as an empty JSON object
    Deno.writeTextFileSync(this.indicesFilePath, "{}", { createNew: true });
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

    try {
      await Deno.remove(this.tempDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors to prevent crashes
      console.warn(`Failed to cleanup discovery temp dir: ${error}`);
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
  ): boolean {
    assert(this.initialized, "Not initialized");
    const timedOut = Date.now() > this.timeoutTS;
    if (timedOut) {
      this.log(
        "warn",
        "Discovery recording timeout reached; skipping remaining samples.",
      );
    }
    this.recorded = true;
    this.cachedMaxOutputError = undefined;

    // Rust module is required - if not available, discovery was already skipped in initialize()
    if (!this.usingRustDualWrite || timedOut) {
      return false; // Discovery skipped - Rust not available or timed out
    }

    // Track selected indices if provided (from binary file processing)
    if (binaryFilePath && recordIndices && recordIndices.length > 0) {
      if (!this.selectedIndices[binaryFilePath]) {
        this.selectedIndices[binaryFilePath] = [];
      }
      this.selectedIndices[binaryFilePath].push(...recordIndices);

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
    for (let i = 0; i < trainingData.length; i++) {
      const record = trainingData[i];

      try {
        // Activate creature with existing input
        this.creature.activate(record.input);
        const discoverMap = this.creature.record(record.output);

        // Accumulate data for Rust (Parquet format)
        this.rustAccumulatedData.push(record);
        this.rustAccumulatedNeuronData.push(discoverMap);
      } catch (error) {
        // If we hit the excessive record() calls error, add context about which sample
        if (
          error instanceof Error && error.message.includes("Excessive record()")
        ) {
          console.error(
            `❌ Error occurred while processing sample ${
              i + 1
            }/${trainingData.length}`,
          );
          console.error(
            `   Total samples accumulated so far: ${this.rustAccumulatedData.length}`,
          );
          console.error(`   Input: ${record.input.slice(0, 5)}...`);
          console.error(`   Output: ${record.output.slice(0, 5)}...`);
        }
        throw error;
      }
    }

    return !timedOut;
  }

  public shouldFlushRustChunk(): boolean {
    if (!this.usingRustDualWrite) return false;
    return this.rustAccumulatedData.length >= this.rustFlushRecords;
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
      console.warn(
        `⚠️  Discovery recording skipped: creature has been cleaned up.`,
      );
      return null;
    }

    if (!this.deps.isRustLibraryAvailable()) {
      console.warn(
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
      const flushDuration = Date.now() - now;
      const remainingSeconds = Math.max(
        0,
        Math.floor((this.timeoutTS - Date.now()) / 1000),
      );
      const flushRate = flushDuration > 0
        ? (pendingSamples / (flushDuration / 1000)).toFixed(2)
        : "∞";
      this.log(
        "info",
        `Flushed ${pendingSamples} samples to ${parquetPath} in ${
          this.formatMillis(flushDuration)
        } (${flushRate} samples/sec, timeout remaining: ${remainingSeconds}s).`,
      );

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
    if (!this.usingRustDualWrite || this.rustAccumulatedData.length === 0) {
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
      console.error("❌ Failed to flush discovery chunk:", error);
      return false;
    }
  }

  public flushRustRecording(): boolean {
    if (!this.usingRustDualWrite) {
      return false;
    }

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
      console.warn(
        `⚠️  Rust library not available when merging discovery chunks. Discovery recording failed.`,
      );
      return false;
    }

    const outputFile = `${this.tempDir}/discovery_data.parquet`;
    const mergeResult = this.deps.mergeDiscoveryParquet({
      outputFile,
      inputFiles: [...this.rustChunkFiles],
    });

    if (!mergeResult || !mergeResult.success) {
      console.error(
        "❌ Rust discovery merge failed:",
        mergeResult?.error ?? "Unknown error",
      );
      return false;
    }

    this.parquetFilePath = mergeResult.outputFile ?? outputFile;
    this.combinedRustAnalysis = undefined;
    this.rustChunkFiles = [];
    return true;
  }

  public static computeRustFlushMetrics(
    data: RustRecordInput["training_data"],
    expectedNeuronCount: number,
    expectedInputLength: number,
    expectedOutputLength: number,
  ): RustRecordBatchStats {
    const aggregation = DiscoverStructure.createRustFlushAggregationInternal(
      expectedInputLength,
      expectedOutputLength,
      expectedNeuronCount,
    );
    data.forEach((record, recordIndex) => {
      DiscoverStructure.observeRustTrainingRecordInternal(
        aggregation,
        record,
        recordIndex,
      );
    });
    const diagnostics = DiscoverStructure
      .finalizeRustFlushDiagnosticsInternal(
        aggregation,
        DiscoverStructure.truncateForLogValue,
      );
    return diagnostics.metrics;
  }

  private emitRustFlushDiagnostics(
    diagnostics: RustFlushDiagnostics,
    timedOut: boolean,
  ): void {
    const hasErrors = diagnostics.errors.length > 0;
    const hasWarnings = diagnostics.warnings.length > 0;
    const shouldLogSummary = timedOut || hasWarnings || hasErrors ||
      this.loggingEnabled;

    if (shouldLogSummary) {
      const level = hasErrors
        ? "error"
        : timedOut || hasWarnings
        ? "warn"
        : "debug";
      this.log(level, diagnostics.summary);
    }

    diagnostics.warnings.forEach((warning) => this.log("warn", warning));
    diagnostics.errors.forEach((error) => this.log("error", error));
  }

  private createRustFlushAggregation(
    expectedInputLength: number,
    expectedOutputLength: number,
    expectedNeuronCount: number,
  ): RustFlushAggregation {
    return DiscoverStructure.createRustFlushAggregationInternal(
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
    DiscoverStructure.observeRustTrainingRecordInternal(
      aggregation,
      record,
      globalSampleIndex,
    );
  }

  private finalizeRustFlushDiagnostics(
    aggregation: RustFlushAggregation,
  ): RustFlushDiagnostics {
    return DiscoverStructure.finalizeRustFlushDiagnosticsInternal(
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
    return DiscoverStructure.truncateForLogValue(value, max);
  }

  private static truncateForLogValue(value: string, max = 120): string {
    if (value.length <= max) {
      return value;
    }
    return `${value.slice(0, max)}…`;
  }

  private static createRustFlushAggregationInternal(
    expectedInputLength: number,
    expectedOutputLength: number,
    expectedNeuronCount: number,
  ): RustFlushAggregation {
    return {
      expectedInputLength,
      expectedOutputLength,
      expectedNeuronCount,
      metrics: {
        sampleCount: 0,
        expectedNeuronCount,
        totalNeuronRecords: 0,
        totalNeuronUuidBytes: 0,
        longestNeuronUuidLength: 0,
        longestNeuronUuid: undefined,
        totalErrorValues: 0,
        maxErrorValuesPerNeuron: 0,
        inputLength: undefined,
        outputLength: undefined,
        recordsWithNoNeuronData: 0,
        recordsWithMismatchedNeuronCount: 0,
        recordsWithInputMismatch: 0,
        recordsWithOutputMismatch: 0,
        missingUuidEntries: 0,
        nonFiniteActivationCount: 0,
        nonFiniteValueCount: 0,
        nonFiniteErrorCount: 0,
        firstMissingUuidLocation: undefined,
        firstNonFiniteActivationLocation: undefined,
        firstNonFiniteValueLocation: undefined,
        firstNonFiniteErrorLocation: undefined,
      },
    };
  }

  private static observeRustTrainingRecordInternal(
    aggregation: RustFlushAggregation,
    record: RustRecordInput["training_data"][number],
    globalSampleIndex: number,
  ): void {
    const metrics = aggregation.metrics;
    metrics.sampleCount += 1;

    if (metrics.inputLength === undefined) {
      metrics.inputLength = record.input.length;
    }
    if (metrics.outputLength === undefined) {
      metrics.outputLength = record.output.length;
    }

    if (record.input.length !== aggregation.expectedInputLength) {
      metrics.recordsWithInputMismatch += 1;
    }

    if (record.output.length !== aggregation.expectedOutputLength) {
      metrics.recordsWithOutputMismatch += 1;
    }

    const neuronData = record.neuron_data ?? [];
    metrics.totalNeuronRecords += neuronData.length;

    if (neuronData.length === 0) {
      metrics.recordsWithNoNeuronData += 1;
    }
    if (neuronData.length !== aggregation.expectedNeuronCount) {
      metrics.recordsWithMismatchedNeuronCount += 1;
    }

    neuronData.forEach((neuron, neuronIndex) => {
      const uuid = typeof neuron.neuron_uuid === "string"
        ? neuron.neuron_uuid
        : "";
      const uuidLength = uuid.length;
      metrics.totalNeuronUuidBytes += uuidLength;

      if (uuidLength === 0) {
        metrics.missingUuidEntries += 1;
        if (!metrics.firstMissingUuidLocation) {
          metrics.firstMissingUuidLocation =
            `record ${globalSampleIndex}, neuron ${neuronIndex}`;
        }
      } else if (uuidLength > metrics.longestNeuronUuidLength) {
        metrics.longestNeuronUuidLength = uuidLength;
        metrics.longestNeuronUuid = uuid;
      }

      if (!Number.isFinite(neuron.activation)) {
        metrics.nonFiniteActivationCount += 1;
        if (!metrics.firstNonFiniteActivationLocation) {
          metrics.firstNonFiniteActivationLocation =
            `record ${globalSampleIndex}, neuron ${neuronIndex}`;
        }
      }

      const value = (neuron as { value?: number }).value;
      if (value !== undefined && value !== null && !Number.isFinite(value)) {
        metrics.nonFiniteValueCount += 1;
        if (!metrics.firstNonFiniteValueLocation) {
          metrics.firstNonFiniteValueLocation =
            `record ${globalSampleIndex}, neuron ${neuronIndex}`;
        }
      }

      const errors = Array.isArray(neuron.errors) ? neuron.errors : [];
      const errorCount = errors.length;
      metrics.totalErrorValues += errorCount;
      if (errorCount > metrics.maxErrorValuesPerNeuron) {
        metrics.maxErrorValuesPerNeuron = errorCount;
      }

      // VALIDATION: Check for unreasonable error counts
      // This is per-record (per-sample) validation.
      // During backpropagation for ONE sample, each neuron records ONE error
      // - Expected: 1 error per neuron per sample
      // - Multiplier of 2 provides buffer for edge cases
      // - Minimum threshold of 10 for safety
      const outputCount = aggregation.expectedOutputLength;
      const maxReasonableErrorsPerNeuronPerRecord = Math.max(
        10,
        outputCount * 2,
      );

      if (errorCount > maxReasonableErrorsPerNeuronPerRecord) {
        console.error(
          `❌ CRITICAL: Neuron ${uuid} has ${errorCount} errors in record ${globalSampleIndex}, ` +
            `which exceeds reasonable maximum (${maxReasonableErrorsPerNeuronPerRecord})!`,
        );
        console.error(
          `Record ${globalSampleIndex}, Neuron ${neuronIndex}`,
        );
        console.error(
          `Outputs: ${outputCount} (expected ≤${
            outputCount * 2
          } errors per neuron per sample)`,
        );
        console.error(`Errors array sample (first 10):`, errors.slice(0, 10));
        throw new Error(
          `Data corruption detected: neuron ${uuid} has ${errorCount} errors in a single record, ` +
            `which far exceeds reasonable maximum (${maxReasonableErrorsPerNeuronPerRecord}). ` +
            `During backprop, each neuron should record ONE error per sample. This indicates record() is being called too many times.`,
        );
      }

      // LOG WARNING: Log if we're seeing unusually high error counts per sample
      const warningThreshold = Math.max(5, Math.ceil(outputCount * 1.5));
      if (errorCount > warningThreshold) {
        console.warn(
          `⚠️  Record ${globalSampleIndex}: Neuron ${uuid} has ${errorCount} errors ` +
            `(expected ≤${warningThreshold} for ${outputCount} outputs). ` +
            `During backprop, record() should be called once per output. Multiple calls suggest a logic error.`,
        );
      }

      errors.forEach((errorValue, errorIndex) => {
        if (!Number.isFinite(errorValue)) {
          metrics.nonFiniteErrorCount += 1;
          if (!metrics.firstNonFiniteErrorLocation) {
            metrics.firstNonFiniteErrorLocation =
              `record ${globalSampleIndex}, neuron ${neuronIndex}, error ${errorIndex}`;
          }
        }
      });
    });
  }

  private static finalizeRustFlushDiagnosticsInternal(
    aggregation: RustFlushAggregation,
    truncate: (value: string, max?: number) => string,
  ): RustFlushDiagnostics {
    const { metrics } = aggregation;
    const summaryParts = [
      `samples=${metrics.sampleCount}`,
      `expectedNeuronCount=${aggregation.expectedNeuronCount}`,
      `recordsWithNoNeuronData=${metrics.recordsWithNoNeuronData}`,
      `recordsWithMismatchedNeuronCount=${metrics.recordsWithMismatchedNeuronCount}`,
      `recordsWithInputMismatch=${metrics.recordsWithInputMismatch}`,
      `recordsWithOutputMismatch=${metrics.recordsWithOutputMismatch}`,
      `missingUuidEntries=${metrics.missingUuidEntries}`,
      `nonFiniteActivationValues=${metrics.nonFiniteActivationCount}`,
      `nonFiniteNeuronValues=${metrics.nonFiniteValueCount}`,
      `nonFiniteErrorValues=${metrics.nonFiniteErrorCount}`,
    ];

    if (metrics.longestNeuronUuid && metrics.longestNeuronUuidLength > 0) {
      summaryParts.push(
        `longestUuid="${
          truncate(metrics.longestNeuronUuid)
        }" (${metrics.longestNeuronUuidLength})`,
      );
    }

    const warnings: string[] = [];
    if (metrics.recordsWithNoNeuronData > 0) {
      warnings.push(
        `Rust flush detected ${metrics.recordsWithNoNeuronData} record(s) without neuron data.`,
      );
    }
    if (metrics.recordsWithMismatchedNeuronCount > 0) {
      warnings.push(
        `Rust flush detected ${metrics.recordsWithMismatchedNeuronCount} record(s) with neuron count mismatch (expected ${aggregation.expectedNeuronCount}).`,
      );
    }
    if (metrics.recordsWithInputMismatch > 0) {
      warnings.push(
        `Rust flush detected ${metrics.recordsWithInputMismatch} record(s) where input length != expected ${aggregation.expectedInputLength}.`,
      );
    }
    if (metrics.recordsWithOutputMismatch > 0) {
      warnings.push(
        `Rust flush detected ${metrics.recordsWithOutputMismatch} record(s) where output length != expected ${aggregation.expectedOutputLength}.`,
      );
    }

    const errors: string[] = [];
    if (metrics.missingUuidEntries > 0) {
      const location = metrics.firstMissingUuidLocation
        ? ` (first observed at ${metrics.firstMissingUuidLocation})`
        : "";
      errors.push(
        `Rust flush encountered ${metrics.missingUuidEntries} neuron entries with missing UUID${location}.`,
      );
    }
    if (metrics.nonFiniteActivationCount > 0) {
      errors.push(
        `Rust flush encountered ${metrics.nonFiniteActivationCount} non-finite activation value(s)${
          metrics.firstNonFiniteActivationLocation
            ? ` (first observed at ${metrics.firstNonFiniteActivationLocation})`
            : ""
        }.`,
      );
    }
    if (metrics.nonFiniteValueCount > 0) {
      errors.push(
        `Rust flush encountered ${metrics.nonFiniteValueCount} non-finite optional neuron value(s)${
          metrics.firstNonFiniteValueLocation
            ? ` (first observed at ${metrics.firstNonFiniteValueLocation})`
            : ""
        }.`,
      );
    }
    if (metrics.nonFiniteErrorCount > 0) {
      errors.push(
        `Rust flush encountered ${metrics.nonFiniteErrorCount} non-finite error value(s)${
          metrics.firstNonFiniteErrorLocation
            ? ` (first observed at ${metrics.firstNonFiniteErrorLocation})`
            : ""
        }.`,
      );
    }

    return {
      summary: `Rust flush diagnostics: ${summaryParts.join(", ")}`,
      warnings,
      errors,
      metrics,
    };
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
      }, helping ${
        (candidate.expectedImprovementPercentage * 100).toFixed(1)
      }% more records than it harms (${candidate.improvedCount}/${candidate.totalCount})`,
    );
  }

  private logHelpfulNeuron(
    candidate: CandidateNeuron,
  ): void {
    this.log(
      "info",
      `Rust discovered beneficial ${candidate.squash} neuron linking ${candidate.fromNeuronUUID} -> ${candidate.toNeuronUUID} with incoming ${
        candidate.incomingWeight.toFixed(4)
      } and outgoing ${candidate.outgoingWeight.toFixed(4)}, improving ${
        (candidate.expectedImprovementPercentage * 100).toFixed(1)
      }% of records (${candidate.improvedCount}/${candidate.totalCount})`,
    );
  }

  private tryRustHelpfulNeurons(
    focusList: string[],
  ): CandidateNeuron[] | undefined {
    const combinedResult = this.readRustCombinedAnalysis(
      focusList,
      false,
      true,
    )?.neuron;
    const rustResult = combinedResult ?? this.runRustNeuronAnalysis(focusList);
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
      .filter((candidate) =>
        candidate.expectedImprovementPercentage > this.improvementThreshold
      );

    if (candidates.length === 0) {
      this.logRustNoImprovement("neuron", focusList, rustResult.diagnostics);
      return [];
    }

    candidates.sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
    );
    return candidates;
  }

  private tryRustHelpfulSynapses(
    focusList: string[],
  ): CandidateSynapse[] | undefined {
    const combinedResult = this.readRustCombinedAnalysis(
      focusList,
      true,
      false,
    )?.synapse;
    const rustResult = combinedResult ?? this.runRustSynapseAnalysis(focusList);
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
      .filter((candidate) =>
        candidate.expectedImprovementPercentage > this.improvementThreshold
      );

    if (candidates.length === 0) {
      this.logRustNoImprovement("synapse", focusList, rustResult.diagnostics);
      return [];
    }

    const topCandidates = this.filterTopSynapseCandidates(candidates);
    if (topCandidates.length === 0) {
      this.logRustNoImprovement("synapse", focusList, rustResult.diagnostics);
      return [];
    }

    topCandidates.sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
    );
    return topCandidates;
  }

  private tryRustHarmfulCandidates(
    focusList: string[],
  ): CandidateSynapse[] | undefined {
    const combinedResult = this.readRustCombinedAnalysis(
      focusList,
      true,
      false,
    )?.synapse;
    const rustResult = combinedResult ?? this.runRustSynapseAnalysis(focusList);
    if (!rustResult || !rustResult.harmfulSynapses) {
      return undefined;
    }

    const candidates = rustResult.harmfulSynapses
      .map((candidate) => this.mapRustCandidate(candidate))
      .filter((candidate) =>
        candidate.expectedImprovementPercentage < this.harmfulThreshold
      );

    if (candidates.length === 0) {
      return [];
    }

    candidates.sort((a, b) =>
      a.expectedImprovementPercentage - b.expectedImprovementPercentage
    );
    return candidates;
  }

  public collectRustAnalysisCandidates(
    focusList: string[],
    options: {
      helpfulSynapse: boolean;
      harmfulSynapse: boolean;
      helpfulNeuron: boolean;
    },
  ): CandidateAnalysisBundle | undefined {
    const includeSynapse = options.helpfulSynapse || options.harmfulSynapse;
    const includeNeuron = options.helpfulNeuron;
    if (!includeSynapse && !includeNeuron) {
      return {};
    }

    const combinedResult = this.ensureRustCombinedAnalysis(
      focusList,
      includeSynapse,
      includeNeuron,
    );
    if (!combinedResult) {
      return undefined;
    }

    const bundle: CandidateAnalysisBundle = {};
    if (options.helpfulSynapse) {
      const helpfulSynapses = this.tryRustHelpfulSynapses(focusList);
      if (helpfulSynapses && helpfulSynapses.length > 0) {
        bundle.helpfulSynapses = helpfulSynapses;
      }
    }

    if (options.harmfulSynapse) {
      const harmfulSynapses = this.tryRustHarmfulCandidates(focusList);
      if (harmfulSynapses && harmfulSynapses.length > 0) {
        bundle.harmfulSynapse = harmfulSynapses[0];
      }
    }

    if (options.helpfulNeuron) {
      const helpfulNeurons = this.tryRustHelpfulNeurons(focusList);
      if (helpfulNeurons && helpfulNeurons.length > 0) {
        bundle.helpfulNeurons = helpfulNeurons;
      }
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
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
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
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
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
        candidate.expectedImprovementPercentage >
          existing.expectedImprovementPercentage
      ) {
        grouped.set(candidate.toNeuronUUID, candidate);
      }
    });
    return Array.from(grouped.values()).sort((a, b) =>
      b.expectedImprovementPercentage - a.expectedImprovementPercentage
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
        candidate.expectedImprovementPercentage >
          existing.expectedImprovementPercentage
      ) {
        grouped.set(candidate.toNeuronUUID, candidate);
      }
    });
    return Array.from(grouped.values());
  }

  private logHarmfulSynapse(candidate: CandidateSynapse): void {
    const harmPercent = Math.abs(candidate.expectedImprovementPercentage * 100);
    this.log(
      "info",
      `Rust discovered harmful synapse from ${candidate.fromNeuronUUID} to ${candidate.toNeuronUUID}, harming ${
        harmPercent.toFixed(1)
      }% more records than it helps (${candidate.improvedCount}/${candidate.totalCount})`,
    );
  }

  private mapRustCandidate(
    candidate: RustCandidateSynapse,
  ): CandidateSynapse {
    return {
      fromNeuronUUID: candidate.fromNeuronUuid,
      toNeuronUUID: candidate.toNeuronUuid,
      weight: candidate.weight,
      expectedImprovementPercentage: candidate.expectedImprovementPercentage,
      improvedCount: candidate.improvedCount,
      totalCount: candidate.totalCount,
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
      expectedImprovementPercentage: candidate.expectedImprovementPercentage,
      improvedCount: candidate.improvedCount,
      totalCount: candidate.totalCount,
    };
  }

  private runRustNeuronAnalysis(
    focusList: string[],
  ): RustAnalyzeNeuronsResult | undefined {
    if (!this.parquetFilePath) {
      return undefined;
    }

    if (
      !this.deps.isRustDiscoveryEnabled() ||
      !this.deps.isRustLibraryAvailable()
    ) {
      return undefined;
    }

    this.creature.validate();

    const rustInput: RustAnalyzeNeuronsInput = {
      parquetFile: this.parquetFilePath,
      creature: creatureToRustFormat(this.creature.exportJSON()),
      focusNeurons: focusList,
      improvementThreshold: this.improvementThreshold,
      maxCandidates: Math.max(25, focusList.length * 5),
      requireGpu: Deno.build.os === "darwin",
      analysisDeadlineMs: this.analysisDeadlineMs,
    };

    try {
      const result = this.deps.analyzeNeurons(rustInput);
      if (!result || !result.success) {
        if (this.loggingEnabled) {
          this.log(
            "debug",
            `Rust neuron analysis failed: ${result?.error ?? "Unknown error"}`,
          );
        }
        return undefined;
      }
      if (Deno.env.get("DEBUG_RUST_ANALYSIS") === "1") {
        console.log(
          "rust-neuron-analysis",
          JSON.stringify({ focusList, result }, (_key, value) => value, 2),
        );
      }
      if (this.loggingEnabled && result.gpuUsed !== undefined) {
        this.log(
          "info",
          `Rust neuron analysis ${
            result.gpuUsed ? "using GPU" : "using CPU fallback"
          } (${result.helpfulNeurons?.length ?? 0} candidates)`,
        );
      }
      return result;
    } catch (error) {
      this.log(
        "warn",
        `Rust neuron analysis threw error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
      return undefined;
    }
  }

  private runRustSynapseAnalysis(
    focusList: string[],
  ): RustAnalyzeSynapsesResult | undefined {
    if (!this.parquetFilePath) {
      return undefined;
    }

    if (
      !this.deps.isRustDiscoveryEnabled() ||
      !this.deps.isRustLibraryAvailable()
    ) {
      return undefined;
    }

    this.creature.validate();

    const rustInput: RustAnalyzeSynapsesInput = {
      parquetFile: this.parquetFilePath,
      creature: creatureToRustFormat(this.creature.exportJSON()),
      focusNeurons: focusList,
      improvementThreshold: this.improvementThreshold,
      maxCandidates: Math.max(50, focusList.length * 10),
      requireGpu: Deno.build.os === "darwin",
      analysisDeadlineMs: this.analysisDeadlineMs,
    };

    try {
      const result = this.deps.analyzeSynapses(rustInput);
      if (!result || !result.success) {
        if (this.loggingEnabled) {
          this.log(
            "debug",
            `Rust synapse analysis failed: ${result?.error ?? "Unknown error"}`,
          );
        }
        return undefined;
      }
      if (Deno.env.get("DEBUG_RUST_ANALYSIS") === "1") {
        console.log(
          "rust-analysis",
          JSON.stringify({ focusList, result }, (_key, value) => value, 2),
        );
      }
      if (this.loggingEnabled && result.gpuUsed !== undefined) {
        this.log(
          "info",
          `Rust synapse analysis ${
            result.gpuUsed ? "using GPU" : "using CPU fallback"
          } (${result.helpfulSynapses?.length ?? 0} helpful, ${
            result.harmfulSynapses?.length ?? 0
          } harmful candidates)`,
        );
      }
      return result;
    } catch (error) {
      this.log(
        "warn",
        `Rust synapse analysis threw error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Analyzes recorded neuron data to identify and evaluate potential synapse additions.
   */
  public async analyze(
    discoveryMaxNeurons: number,
  ): Promise<CandidateSynapse[] | undefined> {
    if (this.recorded === false) {
      this.log("warn", "No recorded data to analyze.");
      return undefined;
    }
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
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
        if (this.loggingEnabled) console.debug(...args);
        break;
      case "info":
        if (this.loggingEnabled) console.info(...args);
        break;
      case "warn":
        console.warn(...args);
        break;
      case "error":
        console.error(...args);
        break;
      default:
        console.log(...args);
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
    if (!this.deps.analyzeAll) {
      return undefined;
    }
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

    if (this.deps.analyzeParallel) {
      const parallelInput: RustParallelAnalysisInput = {
        parquetFile: this.parquetFilePath,
        creature: rustCreature,
        focusNeurons: focusList,
        improvementThreshold: this.improvementThreshold,
        harmfulThreshold: this.harmfulThreshold,
        maxSynapseCandidates: includeSynapse
          ? Math.max(50, focusList.length * 10)
          : undefined,
        maxNeuronCandidates: includeNeuron
          ? Math.max(25, focusList.length * 5)
          : undefined,
        requireGpu: Deno.build.os === "darwin",
        analysisDeadlineMs: this.analysisDeadlineMs,
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

    if (!this.deps.analyzeAll) {
      return undefined;
    }

    const rustInput: RustAnalyzeAllInput = {
      parquetFile: this.parquetFilePath,
      creature: rustCreature,
      focusNeurons: focusList,
      improvementThreshold: this.improvementThreshold,
      harmfulThreshold: this.harmfulThreshold,
      maxSynapseCandidates: includeSynapse
        ? Math.max(50, focusList.length * 10)
        : undefined,
      maxNeuronCandidates: includeNeuron
        ? Math.max(25, focusList.length * 5)
        : undefined,
      requireGpu: Deno.build.os === "darwin",
      analysisDeadlineMs: this.analysisDeadlineMs,
      includeSynapseAnalysis: includeSynapse,
      includeNeuronAnalysis: includeNeuron,
    };

    const rustResult = this.deps.analyzeAll(rustInput);
    if (!rustResult || !rustResult.success) {
      const reason = rustResult?.error ?? "analysis did not return a result";
      if (includeSynapse) {
        this.logRustAnalysisUnavailable("synapse", focusList, reason);
      }
      if (includeNeuron) {
        this.logRustAnalysisUnavailable("neuron", focusList, reason);
      }
      this.combinedRustAnalysis = undefined;
      return undefined;
    }

    this.combinedRustAnalysis = {
      key: cacheKey,
      includeSynapse,
      includeNeuron,
      result: rustResult,
    };
    return rustResult;
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
        parallel.neuronDiagnostics?.length,
    );

    const synapseResult: RustAnalyzeSynapsesResult | undefined =
      hasSynapsePayload
        ? {
          success: true,
          gpuUsed: parallel.synapseGpuUsed,
          helpfulSynapses: parallel.helpfulSynapses,
          harmfulSynapses: parallel.harmfulSynapses,
          diagnostics: parallel.synapseDiagnostics,
        }
        : undefined;
    const neuronResult: RustAnalyzeNeuronsResult | undefined = hasNeuronPayload
      ? {
        success: true,
        gpuUsed: parallel.neuronGpuUsed,
        helpfulNeurons: parallel.helpfulNeurons,
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
        const improvement = typeof detail.expectedImprovementPercentage ===
            "number"
          ? detail.expectedImprovementPercentage
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
      if (detail.expectedImprovementPercentage !== undefined) {
        detailParts.push(
          `expected=${
            (detail.expectedImprovementPercentage * 100).toFixed(2)
          }%`,
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
      if (detail.expectedImprovementPercentage !== undefined) {
        detailParts.push(
          `expected=${
            (detail.expectedImprovementPercentage * 100).toFixed(2)
          }%`,
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

  private processCSVRecord(
    headers: string[],
    values: string[],
  ): DiscoverRecord | null {
    // Handle case where we have more values than headers
    if (values.length > headers.length) {
      // Truncate values to match headers length without warning for performance
      values = values.slice(0, headers.length);
    }

    // Handle case where we have fewer values than headers
    if (values.length < headers.length) {
      // Pad values with empty strings to match headers length without warning for performance
      while (values.length < headers.length) {
        values.push("");
      }
    }

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index];
    });

    const activation = Number.parseFloat(record.activation);
    if (!Number.isFinite(activation)) {
      return null;
    }

    let value = Number.parseFloat(record.value);
    if (!Number.isFinite(value)) {
      value = activation;
    }

    const rawErrors = record.errors ?? "";
    const errors = rawErrors.length === 0
      ? []
      : rawErrors.split("|").map(Number).filter(Number.isFinite);

    return { value, activation, errors };
  }

  private processCSVChunk(
    chunk: string,
    partialLine: string,
    headers: string[],
    isFirstLine: boolean,
    records: DiscoverRecord[],
  ): string {
    const lines = (partialLine + chunk).split("\n");
    const newPartialLine = lines.pop() || ""; // Keep the last partial line for next iteration

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) continue;

      if (isFirstLine) {
        const headerValues = parseCsv(trimmedLine, { skipFirstRow: false })[0];
        headers.push(...headerValues);
        isFirstLine = false;
        continue;
      }

      const values = parseCsv(trimmedLine, { skipFirstRow: false })[0];
      const record = this.processCSVRecord(headers, values);
      if (record) {
        records.push(record);
      }
    }

    // Clear lines array to help GC
    lines.length = 0;

    return newPartialLine;
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
          console.warn(
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
   * This avoids writing and reading CSV files for input neurons.
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
              console.warn(
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

  private async loadCSV(file: string): Promise<DiscoverRecord[]> {
    // Check if this is an input neuron - always read from binary files
    const fileName = file.split("/").pop();
    if (fileName && fileName.startsWith("input-")) {
      // Extract neuron index from filename like "input-5.csv"
      const match = fileName.match(/^input-(\d+)\.csv$/);
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

    // Extract neuron UUID from filename like "hidden-3.csv"
    const match = fileName?.match(/^(.+)\.csv$/);
    if (!match) {
      throw new Error(`Invalid neuron file name: ${fileName}`);
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

    // Read from Parquet via Rust FFI (simple approach - optimize later)
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
    // Build maps for efficient lookup
    const neuronIndexMap = new Map<string, number>();
    const outputNeuronIndices = new Set<number>();

    // Build neuron index map and identify output neurons
    this.creature.neurons.forEach((neuron, index) => {
      neuronIndexMap.set(neuron.uuid, index);
      if (neuron.type === "output") {
        outputNeuronIndices.add(index);
      }
    });

    // If this is an output neuron, it has direct impact
    const neuronIndex = neuronIndexMap.get(neuronUUID);
    if (neuronIndex === undefined) {
      return 0;
    }
    if (outputNeuronIndices.has(neuronIndex)) {
      return derivativeMap?.get(neuronUUID) ?? 1.0;
    }

    // Use dynamic programming to calculate impact
    // Impact of a neuron = max of (impact of neurons it connects to × abs(weight))
    // This ensures we take the maximum path impact rather than summing all paths
    // Handle cycles by using a path-based visited set (per path, not global)
    const impactCache = new Map<string, number>();

    const calculateImpactRecursive = (
      uuid: string,
      pathVisited: Set<string>,
    ): number => {
      // Check cache first
      if (impactCache.has(uuid)) {
        return impactCache.get(uuid)!;
      }

      // Prevent infinite loops in current path (cycle detection)
      if (pathVisited.has(uuid)) {
        // Cycle detected - return 0 to avoid infinite recursion
        // This means cycles don't contribute to impact
        return 0;
      }

      pathVisited.add(uuid);

      const index = neuronIndexMap.get(uuid);
      if (index === undefined) {
        pathVisited.delete(uuid);
        return 0;
      }

      // Output neurons have base impact of 1.0 * derivative
      if (outputNeuronIndices.has(index)) {
        const impact = derivativeMap?.get(uuid) ?? 1.0;
        impactCache.set(uuid, impact);
        pathVisited.delete(uuid);
        return impact;
      }

      // Get outgoing synapses from this neuron
      const outgoingSynapses = this.creature.outwardConnections(index);
      if (outgoingSynapses.length === 0) {
        // No outgoing connections means no impact
        impactCache.set(uuid, 0);
        pathVisited.delete(uuid);
        return 0;
      }

      // Calculate impact by taking the maximum contribution from all connected neurons
      // This ensures we don't double-count neurons on the same path
      let maxImpact = 0;
      for (const synapse of outgoingSynapses) {
        const toIndex = synapse.to;
        const toNeuron = this.creature.neurons[toIndex];
        if (toNeuron) {
          const toUUID = toNeuron.uuid;
          // Create a new path visited set for each branch to allow exploring all paths
          const branchPathVisited = new Set(pathVisited);
          const toImpact = calculateImpactRecursive(toUUID, branchPathVisited);
          if (!Number.isFinite(toImpact) || toImpact <= 0) {
            continue;
          }
          const absWeight = Math.abs(synapse.weight);
          const weightContribution = absWeight * toImpact;
          // if (weightContribution > toImpact) {
          //   weightContribution = toImpact;
          // }
          maxImpact = Math.max(maxImpact, weightContribution);
        }
      }

      // Apply THIS neuron's derivative
      let myDerivative: number;
      if (derivativeMap) {
        // When derivativeMap is provided, use it or default to 1.0
        // Never fall back to computeSquashDerivative here because we're in
        // offline analysis context where creature.state may be stale/uninitialized
        myDerivative = derivativeMap.get(uuid) ?? 1.0;
      } else {
        // Only use computeSquashDerivative when no derivativeMap is provided
        // (e.g., during online analysis when state is current)
        myDerivative = this.computeSquashDerivative(uuid);
      }
      maxImpact *= myDerivative;

      pathVisited.delete(uuid);
      impactCache.set(uuid, maxImpact);
      return maxImpact;
    };

    return calculateImpactRecursive(neuronUUID, new Set<string>());
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
  public async listViableNeurons(
    targetCount?: number,
  ): Promise<NeuronErrorInfo[]> {
    if (!this.recorded) {
      console.warn("No recorded data to list neurons.");
      return [];
    }

    const rustResult = this.tryRustFocusRanking(targetCount);
    if (rustResult) {
      return rustResult;
    }

    return await this.listViableNeuronsFallback(targetCount);
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
      const result = this.deps.rankFocusNeurons({
        parquetFile: this.parquetFilePath,
        creature: rustCreature,
        maxResults,
      });

      if (!result || !result.success || !result.neurons) {
        if (this.loggingEnabled && result?.error) {
          this.log(
            "debug",
            `Rust focus ranking failed: ${result.error}`,
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
        this.log(
          "debug",
          `Rust focus ranking returned ${result.neurons.length} neuron(s) in ${duration}.`,
        );
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

  private async listViableNeuronsFallback(
    targetCount?: number,
  ): Promise<NeuronErrorInfo[]> {
    const start = Date.now();
    const neurons = this.creature.neurons.filter((neuron) =>
      this.isSelectableNeuron(neuron)
    );
    const totalNeurons = neurons.length;
    const results: NeuronErrorInfo[] = [];
    let totalInvalidErrorCount = 0;
    let neuronsWithInvalidErrors = 0;
    let processedCount = 0;
    let timedOut = false;
    const maxOutputError = await this.getMaxOutputError();
    const impactCache = new Map<string, number>();

    const concurrency = Math.min(
      Math.max(4, Math.min(32, totalNeurons || 1)),
      totalNeurons || 1,
    );
    let index = 0;
    let stopRequested = false;
    const earlyLimit = targetCount
      ? Math.max(targetCount * 4, 64)
      : Number.POSITIVE_INFINITY;

    // Pre-calculate average derivatives for all neurons to account for saturation
    // This map will be used by calculateNeuronImpact
    const derivativeMap = new Map<string, number>();

    // Iterate all neurons in creature for derivatives
    const allNeurons = this.creature.neurons;
    const derivConcurrency = 16;
    for (let i = 0; i < allNeurons.length; i += derivConcurrency) {
      const chunk = allNeurons.slice(i, i + derivConcurrency);
      // deno-lint-ignore no-await-in-loop
      await Promise.all(chunk.map(async (n) => {
        try {
          const neuronSquashName = n.squash ?? "IDENTITY";
          const neuronSquash = Activations.find(
            neuronSquashName,
          ) as ActivationInterface;
          // Use same sampling logic
          const records = await this.loadCSV(`${this.tempDir}/${n.uuid}.csv`);
          let derivativeSum = 0;
          let derivativeCount = 0;
          const sampleSize = Math.min(records.length, 50);
          const step = Math.max(1, Math.floor(records.length / sampleSize));

          for (let j = 0; j < records.length; j += step) {
            const val = records[j].value;
            if (Number.isFinite(val)) {
              const eps = 1e-4;
              const y1 = neuronSquash.squash(val as number);
              const y2 = neuronSquash.squash((val as number) + eps);
              const derivative = (y2 - y1) / eps;
              if (Number.isFinite(derivative)) {
                derivativeSum += Math.abs(derivative);
                derivativeCount++;
              }
            }
            if (derivativeCount >= sampleSize) break;
          }
          const avg = derivativeCount > 0
            ? derivativeSum / derivativeCount
            : 1.0;
          derivativeMap.set(n.uuid, avg);
        } catch (_e) {
          derivativeMap.set(n.uuid, 1.0);
        }
      }));
    }

    const processNext = async () => {
      while (true) {
        const currentIndex = index++;
        if (currentIndex >= totalNeurons) {
          break;
        }
        if (Date.now() > this.timeoutTS) {
          timedOut = true;
          break;
        }
        if (stopRequested) {
          break;
        }

        const neuron = neurons[currentIndex];
        try {
          const neuronSquashName = neuron.squash ?? "IDENTITY";
          const neuronSquash = Activations.find(
            neuronSquashName,
          ) as ActivationInterface;
          // deno-lint-ignore no-await-in-loop
          const records = await this.loadCSV(
            `${this.tempDir}/${neuron.uuid}.csv`,
          );

          let invalidErrorCount = 0;
          let absoluteErrorSum = 0;
          let errorValueCount = 0;
          let activationDeltaSum = 0;
          let activationDeltaCount = 0;
          for (const record of records) {
            const baseValue = record.value;
            const baseActivation = Number.isFinite(record.activation)
              ? record.activation
              : (Number.isFinite(baseValue)
                ? neuronSquash.squash(baseValue as number)
                : undefined);
            for (const err of record.errors) {
              if (!Number.isFinite(err)) {
                invalidErrorCount++;
                continue;
              }
              absoluteErrorSum += Math.abs(err);
              errorValueCount++;

              if (
                Number.isFinite(baseValue) && baseActivation !== undefined &&
                Number.isFinite(baseActivation)
              ) {
                const targetValue = (baseValue as number) + err;
                if (Number.isFinite(targetValue)) {
                  const targetActivation = neuronSquash.squash(targetValue);
                  if (Number.isFinite(targetActivation)) {
                    const delta = Math.abs(
                      targetActivation - (baseActivation as number),
                    );
                    if (Number.isFinite(delta)) {
                      activationDeltaSum += delta;
                      activationDeltaCount++;
                    }
                  }
                }
              }
            }
          }

          if (invalidErrorCount > 0) {
            totalInvalidErrorCount += invalidErrorCount;
            neuronsWithInvalidErrors++;
            console.warn(
              `⚠️  WARNING: Neuron ${neuron.uuid} has ${invalidErrorCount} invalid error values (NaN/Infinity) out of ${
                errorValueCount + invalidErrorCount
              } total error values. This indicates a bug in error calculation or data corruption.`,
            );
          }

          const averageRawError = errorValueCount > 0
            ? absoluteErrorSum / errorValueCount
            : 0;
          const activationAverage = activationDeltaCount > 0
            ? activationDeltaSum / activationDeltaCount
            : averageRawError;
          const clampedError = maxOutputError > 0
            ? Math.min(activationAverage, maxOutputError)
            : activationAverage;

          records.length = 0;

          let impact = impactCache.get(neuron.uuid);
          if (impact === undefined) {
            const computedImpact = this.calculateNeuronImpact(
              neuron.uuid,
              derivativeMap,
            );
            impact = Number.isFinite(computedImpact) ? computedImpact : 0;
            impactCache.set(neuron.uuid, impact);
          }

          results.push({
            uuid: neuron.uuid,
            totalError: clampedError,
            impact,
          });
        } catch (error) {
          console.error(`Error processing neuron ${neuron.uuid}`, error);
        } finally {
          processedCount++;
          if (this.loggingEnabled && processedCount % 25 === 0) {
            this.log(
              "debug",
              `Neuron scan progress: ${processedCount}/${totalNeurons} processed`,
            );
          }
          if (!stopRequested && results.length >= earlyLimit) {
            stopRequested = true;
          }
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => processNext());
    await Promise.all(workers);

    const durationMs = Date.now() - start;
    this.lastNeuronScanStats = {
      processed: processedCount,
      total: totalNeurons,
      timedOut,
      durationMs,
    };

    if (totalInvalidErrorCount > 0) {
      console.error(
        `❌ DISCOVERY DATA QUALITY ISSUE: Found ${totalInvalidErrorCount} invalid error values across ${neuronsWithInvalidErrors} neurons (out of ${neurons.length} total)`,
      );
      console.error(
        `   This suggests a bug in creature.record() or error calculation during discovery recording.`,
      );
    }

    if (timedOut) {
      this.log(
        "warn",
        `Neuron scan timed out after ${
          this.formatMillis(durationMs)
        } (${processedCount}/${totalNeurons} processed). Continuing with partial results.`,
      );
    } else if (stopRequested && this.loggingEnabled) {
      this.log(
        "debug",
        `Neuron scan reached early target of ${earlyLimit} neurons in ${
          this.formatMillis(durationMs)
        }.`,
      );
    } else if (this.loggingEnabled) {
      this.log(
        "debug",
        `Neuron scan completed in ${
          this.formatMillis(durationMs)
        } (${processedCount} neurons).`,
      );
    }

    return results
      .filter((neuron) => neuron.totalError > 0)
      .sort((a, b) => b.totalError - a.totalError);
  }

  /**
   * Selects a neuron randomly, weighted by total error × impact, favoring neurons with higher
   * error and greater influence on outputs. Implements "roulette wheel" selection.
   *
   * Impact measures how much a neuron affects outputs through its outgoing synapse weights.
   * Neurons with high error but low impact (e.g., high error but very low weights) will have
   * lower selection probability, while neurons with both high error and high impact will be
   * prioritized. Neurons with zero impact can still be selected, just with much lower probability.
   *
   * Reference:
   * - Goldberg, D. E. (1989). Genetic Algorithms in Search, Optimization and Machine Learning.
   */
  public async selectNeuronsWeightedByError(count: number): Promise<string[]> {
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
        return trimmed;
      }
    }
    const neuronErrors = await this.listViableNeurons(count);
    if (neuronErrors.length === 0) return [];

    const maxOutputError = await this.getMaxOutputError();
    const hasOutputCap = maxOutputError > 0;
    const EPSILON = 0.0001;
    const rawWeights = neuronErrors.map((n) => ({
      uuid: n.uuid,
      raw: n.totalError * (n.impact + EPSILON),
    }));
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
      return uuids;
    }
    const selectedUUIDs: Set<string> = new Set();

    // Guard against NaN, Infinity, or zero total weighted sum
    if (!Number.isFinite(totalWeightedSum)) {
      console.error(
        `❌ CRITICAL ERROR: totalWeightedSum is ${totalWeightedSum} (NaN or Infinity). This indicates corrupt error/impact calculations in the discovery process!`,
      );
      console.error(
        `   Neuron weighted summary: ${
          weightedValues.slice(0, 5).map((n) =>
            `${n.uuid.slice(-8)}: weight=${n.weight}`
          ).join(", ")
        }...`,
      );
      // Fallback to random selection to prevent infinite loops
      console.warn(
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
      return fallback;
    }

    if (totalWeightedSum <= 0) {
      console.warn(
        `⚠️  WARNING: totalWeightedSum is ${totalWeightedSum} (zero or negative). All neurons have zero error × impact?`,
      );
      console.warn(`   Falling back to random neuron selection`);
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
      console.error(
        `❌ ERROR: Selection reached max iterations (${maxIterations}), only selected ${selectedUUIDs.size}/${count} neurons`,
      );
      console.error(
        `   This should not happen with the hybrid approach. Please report this.`,
      );
      console.error(
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
    return selection;
  }

  /**
   * Entry point for automatic synapse pruning using error-driven analysis.
   * Selects high-error neurons and evaluates their incoming synapses for removal.
   *
   * @param discoveryMaxNeurons - Number of neurons to consider, weighted by error magnitude.
   * @returns A modified Creature with harmful synapse(s) removed, or null if no change was needed.
   */
  async analyzeSynapsesForRemoval(
    discoveryMaxNeurons: number,
  ): Promise<CandidateSynapse | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
    );
    return this.analyzeSelectedNeuronsForRemoval(focusList);
  }

  /**
   * Randomly selects a neuron and evaluates its activation function to identify squash function modifications.
   *
   * @param discoveryMaxNeurons - Number of neurons to consider, weighted by error magnitude.
   * @returns CandidateNeurons with the most promising squash functions modifications.
   */
  async analyzeNeuronsSquashes(
    discoveryMaxNeurons: number,
  ): Promise<CandidateSquash[] | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
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
      const records = await this.loadCSV(`${this.tempDir}/${neuronUUID}.csv`);
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

      const idealValue = value + avgError;
      const idealActivation = currentSquashMethod.squash(idealValue);
      idealActivations.push(idealActivation);
    });

    const baselineError = this.calculateSquashError(
      idealActivations,
      currentActivations,
    );
    let lowestError = baselineError;
    let bestSquash = currentSquash;

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
      }
    }

    // Clear large arrays to help GC
    rawValues.length = 0;
    currentActivations.length = 0;
    idealActivations.length = 0;

    if (bestSquash !== currentSquash) {
      const rawImprovement = (baselineError - lowestError) / baselineError;

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

      const expectedImprovementPercentage = rawImprovement * impactScale;

      // Return candidate even if improvement is small, but only if raw improvement was significant
      if (rawImprovement > 0.01) {
        return {
          neuronUUID,
          previousSquash: currentSquash,
          squash: bestSquash,
          expectedImprovementPercentage: expectedImprovementPercentage,
          improvedError: lowestError,
          currentError: baselineError,
        };
      }
    }

    return undefined;
  }

  /**
   * Removes a synapse from the creature if it is determined to be harmful.
   * This method is used to prune synapses that consistently worsen prediction error.
   * @param ID - Unique identifier for the discovery process.
   * @param creature the Creature instance to modify.
   * @param worseCandidate the candidate synapse to remove.
   * @returns returns a modified Creature with the synapse removed, or null if no change was made.
   */
  public static removeSynapse(
    ID: string,
    creature: Creature,
    worseCandidate?: CandidateSynapse,
  ): Creature | null {
    if (!worseCandidate) return null;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();
    exportJSON.synapses = exportJSON.synapses.filter((synapse) => {
      return synapse.fromUUID !== worseCandidate.fromNeuronUUID ||
        synapse.toUUID !== worseCandidate.toNeuronUUID;
    });

    const tmpCreature = Creature.fromJSON(exportJSON);
    // We modified the structure by filtering synapses, so we must delete UUID
    delete tmpCreature.uuid;
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      const summary =
        `☣️ Removed harmful synapse ${worseCandidate.fromNeuronUUID} -> ${worseCandidate.toNeuronUUID}`;
      addTag(tmpCreature, "Discovery", summary);
      delete tmpCreature.memetic;
      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return null;
  }

  /**
   * Adds a new synapse to the creature if it improves performance.
   *
   * @param ID - Unique identifier for the discovery process.
   * @param creature - The Creature instance to modify.
   * @param bestCandidate - The candidate synapse to add.
   * @returns A modified Creature with the new synapse added, or null if no change was made.
   */
  public static addHelpfulSynapses(
    ID: string,
    creature: Creature,
    helpfulSynapses?: CandidateSynapse[],
  ): Creature | undefined {
    if (!helpfulSynapses || helpfulSynapses.length === 0) return;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();

    const appliedSynapses: CandidateSynapse[] = [];

    helpfulSynapses.forEach((bestCandidate) => {
      const foundSynapse = exportJSON.synapses.find((synapse) => {
        return synapse.fromUUID === bestCandidate.fromNeuronUUID &&
          synapse.toUUID === bestCandidate.toNeuronUUID;
      });

      if (foundSynapse) return;

      const foundFromNeuron = exportJSON.neurons.find((neuron) => {
        return neuron.uuid === bestCandidate.fromNeuronUUID;
      });
      if (!foundFromNeuron) {
        if (!bestCandidate.fromNeuronUUID.startsWith("input-")) {
          return;
        }
      }
      const foundToNeuron = exportJSON.neurons.find((neuron) => {
        /** may have converted a hidden neuron to a constant */
        if (neuron.type !== "hidden" && neuron.type !== "output") return false;
        return neuron.uuid === bestCandidate.toNeuronUUID;
      });
      if (!foundToNeuron) return;

      const addSynapse = {
        fromUUID: bestCandidate.fromNeuronUUID,
        toUUID: bestCandidate.toNeuronUUID,
        weight: bestCandidate.weight,
      };

      addTag(addSynapse as TagsInterface, "discovery", "beneficial");
      exportJSON.synapses.push(addSynapse);
      appliedSynapses.push(bestCandidate);
    });

    const tmpCreature = Creature.fromJSON(exportJSON);
    // We modified the structure by filtering synapses, so we must delete UUID
    delete tmpCreature.uuid;
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID && appliedSynapses.length > 0) {
      const exemplar = appliedSynapses[0];
      const summary = appliedSynapses.length === 1
        ? `🕵🏻‍♂️ Added helpful synapse ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID}`
        : `🕵🏻‍♂️ Added ${appliedSynapses.length} helpful synapses (eg ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID})`;
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      addTag(tmpCreature, "Discovery", summary);
      if (tmpCreature.memetic) {
        tmpCreature.memetic = memeticUpdate(creature, tmpCreature);
      }

      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return;
  }

  public static addHelpfulNeurons(
    ID: string,
    creature: Creature,
    helpfulNeurons?: CandidateNeuron[],
  ): Creature | undefined {
    if (!helpfulNeurons || helpfulNeurons.length === 0) return;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();

    const existingNeuronUUIDs = new Set(
      exportJSON.neurons.map((neuron) => neuron.uuid),
    );
    const processedKeys = new Set<string>();
    const addedNeuronUUIDs: string[] = [];
    const appliedCandidates: CandidateNeuron[] = [];

    helpfulNeurons.forEach((candidate) => {
      const key = `${candidate.fromNeuronUUID}->${candidate.toNeuronUUID}`;
      if (processedKeys.has(key)) return;
      processedKeys.add(key);

      const sourceExists = existingNeuronUUIDs.has(candidate.fromNeuronUUID) ||
        candidate.fromNeuronUUID.startsWith("input-");
      if (!sourceExists) return;

      const targetNeuron = exportJSON.neurons.find((neuron) => {
        if (neuron.type !== "hidden" && neuron.type !== "output") return false;
        return neuron.uuid === candidate.toNeuronUUID;
      });
      if (!targetNeuron) return;

      const newNeuronUUID =
        `hidden-discovery-${(globalThis.crypto?.randomUUID?.() ??
          `fallback-${Math.random().toString(16).slice(2)}`)}`;
      const newNeuron = {
        type: "hidden" as const,
        uuid: newNeuronUUID,
        squash: candidate.squash,
        bias: candidate.bias,
      };
      addTag(newNeuron as TagsInterface, "discovered", candidate.squash);
      const firstOutputIndex = exportJSON.neurons.findIndex((neuron) =>
        neuron.type === "output"
      );
      if (firstOutputIndex >= 0) {
        exportJSON.neurons.splice(firstOutputIndex, 0, newNeuron);
      } else {
        exportJSON.neurons.push(newNeuron);
      }
      existingNeuronUUIDs.add(newNeuronUUID);
      addedNeuronUUIDs.push(newNeuronUUID);
      appliedCandidates.push(candidate);

      const incomingSynapse = {
        fromUUID: candidate.fromNeuronUUID,
        toUUID: newNeuronUUID,
        weight: candidate.incomingWeight,
      };
      addTag(incomingSynapse as TagsInterface, "discovery", "beneficial");
      exportJSON.synapses.push(incomingSynapse);

      const outgoingSynapse = {
        fromUUID: newNeuronUUID,
        toUUID: candidate.toNeuronUUID,
        weight: candidate.outgoingWeight,
      };
      addTag(outgoingSynapse as TagsInterface, "discovery", "beneficial");
      exportJSON.synapses.push(outgoingSynapse);
    });

    if (addedNeuronUUIDs.length === 0) {
      return;
    }

    const tmpCreature = Creature.fromJSON(exportJSON);
    // We modified the structure by filtering synapses, so we must delete UUID
    delete tmpCreature.uuid;
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      if (appliedCandidates.length > 0) {
        const exemplar = appliedCandidates[0];
        const summary = appliedCandidates.length === 1
          ? `🕵🏻‍♂️ Added discovery neuron linking ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID}`
          : `🕵🏻‍♂️ Added ${appliedCandidates.length} discovery neurons (eg ${exemplar.fromNeuronUUID} -> ${exemplar.toNeuronUUID})`;
        addTag(tmpCreature, "Discovery", summary);
      }
      if (tmpCreature.memetic) {
        tmpCreature.memetic = memeticUpdate(creature, tmpCreature);
      }

      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return;
  }

  /**
   * Adjust the squash function of a neuron to improve its performance.
   *
   * @param ID - Unique identifier for the discovery process.
   * @param creature - The Creature instance to modify.
   * @param bestCandidate - The candidate squash function to apply.
   * @returns A modified Creature with the new modified squash, or null if no change was made.
   */
  public static changeSquash(
    ID: string,
    creature: Creature,
    helpfulSquashes?: CandidateSquash[],
  ): Creature | undefined {
    if (!helpfulSquashes || helpfulSquashes.length === 0) return;
    const creatureUUID = CreatureUtil.makeUUID(creature);
    const exportJSON = creature.exportJSON();

    const appliedSquashes: CandidateSquash[] = [];

    helpfulSquashes.forEach((bestCandidate) => {
      const foundNeuron = exportJSON.neurons.find((neuron) => {
        return neuron.uuid === bestCandidate.neuronUUID;
      });

      if (!foundNeuron) return;
      if (foundNeuron.type !== "hidden" && foundNeuron.type !== "output") {
        return;
      }

      addTag(foundNeuron as TagsInterface, "discovered", bestCandidate.squash);

      foundNeuron.squash = bestCandidate.squash;
      appliedSquashes.push(bestCandidate);
    });

    const tmpCreature = Creature.fromJSON(exportJSON);
    // We modified the structure by filtering synapses, so we must delete UUID
    delete tmpCreature.uuid;
    tmpCreature.fix();

    const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
    if (tmpUUID !== creatureUUID) {
      addTag(tmpCreature, "approach", "discovery" as Approach);
      addTag(tmpCreature, "discoveryID", ID);
      if (appliedSquashes.length > 0) {
        const exemplar = appliedSquashes[0];
        const summary = appliedSquashes.length === 1
          ? `🕵🏻‍♂️ Swapped ${exemplar.neuronUUID} squash to ${exemplar.squash}`
          : `🕵🏻‍♂️ Updated squash on ${appliedSquashes.length} neurons (eg ${exemplar.neuronUUID} -> ${exemplar.squash})`;
        addTag(tmpCreature, "Discovery", summary);
      }
      if (tmpCreature.memetic) {
        tmpCreature.memetic = memeticUpdate(creature, tmpCreature);
      }

      removeTag(tmpCreature, "approach-logged");
      tmpCreature.validate();

      return tmpCreature;
    }
    return;
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
}
