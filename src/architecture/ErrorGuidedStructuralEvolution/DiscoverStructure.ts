/**
 * Error-Driven Structural Discovery coordinator.
 *
 * Issue #1472: Refactored from ~3,857 lines into focused modules.
 *
 * This file acts as a thin facade/coordinator that delegates to:
 * - DiscoverLogging.ts      — logging and diagnostic formatting
 * - DiscoverDataLoading.ts  — file I/O and data loading
 * - NeuronImpact.ts         — neuron impact estimation
 * - FocusSelection.ts       — focus neuron selection
 * - DiscoverAnalysis.ts     — analysis and candidate building
 * - DiscoverSquashAnalysis.ts — squash function analysis
 * - RustAnalysisCache.ts    — Rust combined analysis caching
 * - DiscoveryApplication.ts — static discovery application methods
 * - RustFlushDiagnostics.ts — Rust flush diagnostic helpers
 *
 * @see docs/DISCOVERY_GUIDE.md for complete workflow documentation
 */
import { assert } from "@std/assert";
import type { Creature } from "../../Creature.ts";
import { isWasmActivationAvailable } from "../../wasm/mod.ts";
import type { CreatureErrorImpactEstimator } from "../../discovery/NeuronErrorImpactEstimator.ts";
import type { DataRecordInterface } from "../DataSet.ts";
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
  type RustCandidateNeuron,
  type RustCandidateSynapse,
  type RustRecordBatchStats,
  type RustRecordInput,
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
  FocusSelectionSummary,
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

// Extracted modules
import {
  formatMillis,
  logAnalysisSkipped,
  logDiscovery,
  logFocusSelectionDetails as logFocusSelectionDetailsImpl,
  logHarmfulSynapse,
  logHelpfulNeuron,
  logHelpfulSynapse,
  logRustAnalysisUnavailable as logRustAnalysisUnavailableImpl,
  logRustNoImprovement as logRustNoImprovementImpl,
} from "./DiscoverLogging.ts";
import { loadNeuronRecords } from "./DiscoverDataLoading.ts";
import { calculateNeuronImpact, listNeuronsByImpact } from "./NeuronImpact.ts";
import {
  focusSelectionKey,
  listViableNeurons,
  selectNeuronsWeightedByError as selectNeuronsWeightedByErrorImpl,
  updateFocusSelectionSummary,
} from "./FocusSelection.ts";
import {
  collectRustAnalysisCandidates as collectRustAnalysisCandidatesImpl,
  filterTopNeuronCandidates,
  mapRustCandidate as mapRustCandidateImpl,
  mapRustNeuronCandidate as mapRustNeuronCandidateImpl,
  tryRustHarmfulCandidates,
  tryRustHelpfulNeurons,
  tryRustHelpfulSynapses,
  upsertDiscovery,
  upsertNeuronDiscovery,
} from "./DiscoverAnalysis.ts";
import {
  type CombinedAnalysisCache,
  ensureRustCombinedAnalysis as ensureRustCombinedAnalysisImpl,
  readRustCombinedAnalysis as readRustCombinedAnalysisImpl,
} from "./RustAnalysisCache.ts";
import {
  analyzeSelectedNeuronsForHarmfulRemoval as analyzeHarmfulNeuronsImpl,
  findCandidateSquash as findCandidateSquashImpl,
} from "./DiscoverSquashAnalysis.ts";

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
export type {
  FocusNeuronCandidate,
  FocusSelectionAnalysis,
  FocusSelectionMode,
  FocusSelectionSummary,
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
  private rustBinaryFilePaths: Set<string> = new Set();
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
  private cachedRemovalCandidates?:
    import("./DiscoverResult.ts").RemovalCandidate[];
  private combinedRustAnalysis?: CombinedAnalysisCache;
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

    const nonInputNeuronCount =
      creature.neurons.filter((n) => n.type !== "input")
        .length;
    this.rustEstimatedBytesPerSample = (200 * nonInputNeuronCount) +
      (4 * (creature.input + creature.output));

    if (this.skipRecordPhase) {
      ensureDirSync(this.tempDir);
    } else {
      emptyDirSync(this.tempDir);
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  public configureLogging(options: {
    verbose?: boolean;
    discoveryID?: string;
  }): void {
    this.loggingEnabled = Boolean(options?.verbose);
    if (options?.discoveryID) {
      this.discoveryID = options.discoveryID;
    }
  }

  public getTempDir(): string {
    return this.tempDir;
  }

  public shouldSkipRecording(): boolean {
    if (!this.skipRecordPhase) {
      return false;
    }

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

  public initialize(neuronPromisesMap: Map<string, Promise<void>>) {
    assert(!this.initialized, "Already initialized");
    this.initialized = true;

    assert(
      this.deps.isRustDiscoveryEnabled(),
      "Rust discovery must be enabled (library present + permissions granted).",
    );
    this.usingRustDualWrite = true;

    this.creature.neurons.forEach((neuron) => {
      neuronPromisesMap.set(neuron.uuid, Promise.resolve());
    });

    try {
      Deno.writeTextFileSync(this.indicesFilePath, "{}", { createNew: true });
    } catch (e) {
      if (e instanceof Deno.errors.AlreadyExists) {
        return;
      }
      throw e;
    }
  }

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

    this.selectedIndices = {};

    // @ts-ignore - clearing to help GC
    this.creature = null;
    // @ts-ignore - clearing to help GC
    this.discoveries = null;
    // @ts-ignore - clearing to help GC
    this.neuronDiscoveries = null;

    try {
      const { closeRustLibrary } = await import("./RustDiscovery.ts");
      closeRustLibrary();
    } catch {
      // Ignore errors during cleanup
    }

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
      getLogger().warn(`Failed to cleanup discovery temp dir: ${error}`);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private isSelectableNeuronType(neuronType: string | undefined): boolean {
    return neuronType !== "input" && neuronType !== "constant";
  }

  private isSelectableNeuron(neuron: { type: string }): boolean {
    return this.isSelectableNeuronType(neuron.type);
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ): void {
    logDiscovery(
      this.loggingEnabled,
      this.discoveryID,
      level,
      message,
      details,
    );
  }

  private truncateForLog(value: string, max = 120): string {
    return truncateForLogValueImpl(value, max);
  }

  // ── Output error cache ──────────────────────────────────────────────

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

  // ── Recording phase ─────────────────────────────────────────────────

  public record(
    trainingData: DataRecordInterface[],
    _neuronPromisesMap: Map<string, Promise<void>>,
    binaryFilePath?: string,
    recordIndices?: number[],
    options?: Readonly<{
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

    if (
      binaryFilePath && effectiveRecordIndices &&
      effectiveRecordIndices.length > 0
    ) {
      if (!this.selectedIndices[binaryFilePath]) {
        this.selectedIndices[binaryFilePath] = [];
      }
      this.selectedIndices[binaryFilePath].push(...effectiveRecordIndices);

      Deno.writeTextFileSync(
        this.indicesFilePath,
        JSON.stringify(this.selectedIndices),
      );

      if (!this.rustBinaryFilePath) {
        this.rustBinaryFilePath = binaryFilePath;
      }
      this.rustBinaryFilePaths.add(binaryFilePath);
    }

    for (let i = 0; i < effectiveTrainingData.length; i++) {
      const record = effectiveTrainingData[i];
      try {
        assert(
          isWasmActivationAvailable(),
          "WASM activation must be initialised before discovery recording",
        );

        const traceAll = {
          traceNeeded: (_uuid: string) => true,
          propagateNeeded: (_uuid: string) => true,
          updateNeeded: (_uuid: string) => true,
        };
        this.creature.activateAndTrace(
          record.input,
          false,
          traceAll,
        );
        const discoverMap = this.creature.record(record.output);

        this.rustAccumulatedData.push(record);
        this.rustAccumulatedNeuronData.push(discoverMap);
        this.rustAccumulatedEstimatedBytes += this.rustEstimatedBytesPerSample;

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
            this.recordedNeuronTotalAbsError.set(uuid, 0);
          }
        }
      } catch (error) {
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

    let recordIndicesLocal: number[] | undefined = undefined;
    if (this.rustBinaryFilePaths.size === 1 && this.rustBinaryFilePath) {
      const fileIndices = this.selectedIndices[this.rustBinaryFilePath];
      if (fileIndices && fileIndices.length >= pendingSamples) {
        const recentIndices = fileIndices.slice(-pendingSamples);
        recordIndicesLocal = recentIndices.slice();
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
      "record_indices": recordIndicesLocal,
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
            const localRecord = this.rustAccumulatedData[i];
            for (let j = 0; j < this.creature.input; j++) {
              recordArray[j] = localRecord.input[j];
            }
            for (let j = 0; j < this.creature.output; j++) {
              recordArray[this.creature.input + j] = localRecord.output[j];
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
          // Ignore cleanup failures
        }
        try {
          Deno.removeSync(dirname(file), { recursive: true });
        } catch {
          // Ignore directory cleanup failures
        }
      }
    }
    return true;
  }

  // ── Flush diagnostics (delegates) ───────────────────────────────────

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

  // ── Data loading (delegates) ────────────────────────────────────────

  private loadNeuronRecords(
    neuronIdentifier: string,
  ): Promise<DiscoverRecord[]> {
    return loadNeuronRecords(
      neuronIdentifier,
      this.parquetFilePath,
      this.indicesFilePath,
      this.creature.input,
      this.creature.output,
      this.deps,
    );
  }

  // ── Neuron impact (delegates) ───────────────────────────────────────

  private calculateNeuronImpact(
    neuronUUID: string,
    derivativeMap?: Map<string, number>,
  ): number {
    const result = calculateNeuronImpact(
      this.creature,
      neuronUUID,
      this.neuronImpactEstimator,
      this.neuronIndexMap,
      derivativeMap,
    );
    this.neuronImpactEstimator = result.estimator;
    this.neuronIndexMap = result.indexMap;
    return result.impact;
  }

  public listNeuronsByImpact(): NeuronImpactInfo[] {
    const result = listNeuronsByImpact(
      this.creature,
      this.neuronImpactEstimator,
      this.neuronIndexMap,
      (level, message, details) => this.log(level, message, details),
    );
    this.neuronImpactEstimator = result.estimator;
    this.neuronIndexMap = result.indexMap;
    return result.entries;
  }

  // ── Focus selection (delegates) ─────────────────────────────────────

  public listViableNeurons(
    targetCount?: number,
  ): NeuronErrorInfo[] {
    const result = listViableNeurons(
      this.creature,
      this.recorded,
      this.parquetFilePath,
      this.deps,
      this.loggingEnabled,
      this.discoveryID,
      this.recordedNeuronTotalAbsError,
      (uuid) => this.calculateNeuronImpact(uuid),
      (level, message, details) => this.log(level, message, details),
      targetCount,
    );
    if (result.scanStats) {
      this.lastNeuronScanStats = result.scanStats;
    }
    if (result.cachedMaxOutputError) {
      this.cachedMaxOutputError = result.cachedMaxOutputError;
    }
    if (result.removalCandidates) {
      this.cachedRemovalCandidates = result.removalCandidates;
    }
    return result.neurons;
  }

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
        this.lastFocusSelection = updateFocusSelectionSummary(
          this.loggingEnabled,
          this.discoveryID,
          "forced",
          trimmed,
          (level, message, details) => this.log(level, message, details),
          undefined,
          undefined,
          "forced focus override",
        );
        return trimmed;
      }
    }

    const listViableStart = Date.now();
    const allNeuronErrors = this.listViableNeurons(count);
    const listViableTime = Date.now() - listViableStart;
    if (allNeuronErrors.length === 0) return [];

    const maxErrorStart = Date.now();
    const result = await selectNeuronsWeightedByErrorImpl(
      count,
      costOfGrowth,
      allNeuronErrors,
      () => this.getMaxOutputError(),
      this.loggingEnabled,
      this.discoveryID,
      this.tempDir,
      (level, message, details) => this.log(level, message, details),
      retryNumber,
      mode,
    );
    const maxErrorTime = Date.now() - maxErrorStart;

    this.lastFocusSelection = result.focusSelection;

    // Log timing breakdown if either phase took significant time
    if (this.loggingEnabled && (listViableTime > 100 || maxErrorTime > 100)) {
      this.log(
        "debug",
        `Focus selection breakdown: listViableNeurons=${
          formatMillis(listViableTime)
        }, weightedSelection=${formatMillis(maxErrorTime)}`,
      );
    }

    return result.selected;
  }

  // ── Rust analysis cache (delegates) ─────────────────────────────────

  public ensureRustCombinedAnalysis(
    focusList: string[],
    includeSynapse: boolean,
    includeNeuron: boolean,
  ): RustAnalyzeAllResult | undefined {
    const result = ensureRustCombinedAnalysisImpl(
      this.creature,
      this.parquetFilePath,
      this.deps,
      this.combinedRustAnalysis,
      this.analysisDeadlineMs,
      focusList,
      includeSynapse,
      includeNeuron,
      (scope, fl, reason) => this.logRustAnalysisUnavailable(scope, fl, reason),
    );
    this.combinedRustAnalysis = result.cache;
    return result.result;
  }

  // ── Analysis logging helpers ────────────────────────────────────────

  private logRustAnalysisUnavailable(
    scope: "synapse" | "neuron",
    focusList: string[],
    reason: string,
  ): void {
    logRustAnalysisUnavailableImpl(
      this.loggingEnabled,
      this.discoveryID,
      scope,
      focusList,
      reason,
      this.lastFocusSelection,
      focusSelectionKey,
    );
  }

  private logRustNoImprovement(
    scope: "synapse" | "neuron",
    focusList: string[],
    diagnostics?:
      | import("./RustDiscovery.ts").RustSynapseDiagnostic[]
      | import("./RustDiscovery.ts").RustNeuronDiagnostic[],
  ): void {
    logRustNoImprovementImpl(
      this.loggingEnabled,
      this.discoveryID,
      scope,
      focusList,
      this.lastFocusSelection,
      focusSelectionKey,
      diagnostics,
    );
  }

  // ── Analysis (delegates) ────────────────────────────────────────────

  private discoveries: CandidateSynapse[] = [];
  private neuronDiscoveries: CandidateNeuron[] = [];

  // deno-lint-ignore require-await
  public async analyzeSelectedNeurons(
    focusList: string[],
  ): Promise<CandidateSynapse[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeSelectedNeurons");
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
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

    this.ensureRustCombinedAnalysis(focusList, true, false);

    const rustResult = readRustCombinedAnalysisImpl(
      this.combinedRustAnalysis,
      this.parquetFilePath,
      focusList,
      true,
      false,
    );
    const rustCandidates = tryRustHelpfulSynapses(
      rustResult,
      (scope, diagnostics) =>
        this.logRustNoImprovement(scope, focusList, diagnostics),
    );
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

    rustCandidates.forEach((candidate) =>
      upsertDiscovery(this.discoveries, candidate)
    );
    const topCandidate = rustCandidates[0];
    logHelpfulSynapse(this.loggingEnabled, this.discoveryID, topCandidate);
    return Promise.resolve(this.discoveries);
  }

  // deno-lint-ignore require-await
  public async analyzeMissingNeurons(
    focusList: string[],
  ): Promise<CandidateNeuron[] | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log("warn", "Discovery timeout reached in analyzeMissingNeurons");
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
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

    this.ensureRustCombinedAnalysis(focusList, false, true);

    const rustResult = readRustCombinedAnalysisImpl(
      this.combinedRustAnalysis,
      this.parquetFilePath,
      focusList,
      false,
      true,
    );
    const rustCandidates = tryRustHelpfulNeurons(
      rustResult,
      (scope, diagnostics) =>
        this.logRustNoImprovement(scope, focusList, diagnostics),
    );
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

    const bestCandidates = filterTopNeuronCandidates(rustCandidates);
    bestCandidates.forEach((candidate) => {
      upsertNeuronDiscovery(this.neuronDiscoveries, candidate);
      logHelpfulNeuron(this.loggingEnabled, this.discoveryID, candidate);
    });
    return Promise.resolve(bestCandidates);
  }

  public collectRustAnalysisCandidates(
    focusList: string[],
  ): CandidateAnalysisBundle | undefined {
    const combinedResult = this.ensureRustCombinedAnalysis(
      focusList,
      true,
      true,
    );
    return collectRustAnalysisCandidatesImpl(
      combinedResult,
      focusList,
      (scope, diagnostics) =>
        this.logRustNoImprovement(scope, focusList, diagnostics),
    );
  }

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

  // ── Synapse removal (delegates) ─────────────────────────────────────

  public analyzeSelectedNeuronsForRemoval(
    focusList: string[],
  ): Promise<CandidateSynapse | undefined> {
    if (focusList.length === 0) return Promise.resolve(undefined);

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsForRemoval",
      );
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "synapse",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
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

    this.ensureRustCombinedAnalysis(focusList, true, false);

    const rustResult = readRustCombinedAnalysisImpl(
      this.combinedRustAnalysis,
      this.parquetFilePath,
      focusList,
      true,
      false,
    );
    const rustCandidates = tryRustHarmfulCandidates(rustResult);
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
    logHarmfulSynapse(this.loggingEnabled, this.discoveryID, worstCandidate);
    return Promise.resolve(worstCandidate);
  }

  async analyzeSynapsesForRemoval(
    discoveryMaxNeurons: number,
    costOfGrowth: number,
  ): Promise<CandidateSynapse | undefined> {
    const focusList = await this.selectNeuronsWeightedByError(
      discoveryMaxNeurons,
      costOfGrowth,
      undefined,
      "remove",
    );
    return this.analyzeSelectedNeuronsForRemoval(focusList);
  }

  // ── Squash analysis (delegates) ─────────────────────────────────────

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

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsSquashes",
      );
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
      return undefined;
    }

    const candidatePromises = focusList.map(async (neuronUUID) => {
      const records = await this.loadNeuronRecords(
        `${this.tempDir}/${neuronUUID}`,
      );
      return findCandidateSquashImpl(
        this.creature,
        neuronUUID,
        records,
        (uuid, derivativeMap) =>
          this.calculateNeuronImpact(uuid, derivativeMap),
        this.loggingEnabled,
        (level, message, details) => this.log(level, message, details),
      );
    });

    return await Promise.all(candidatePromises).then((candidates) => {
      return candidates.filter((candidate) => candidate !== undefined);
    });
  }

  // ── Harmful neuron analysis (delegates) ─────────────────────────────

  public async analyzeSelectedNeuronsForHarmfulRemoval(
    focusList: string[],
  ): Promise<CandidateHarmfulNeuron[] | undefined> {
    if (focusList.length === 0) return undefined;

    if (this.analysisTimeoutGuardEnabled && Date.now() > this.timeoutTS) {
      this.log(
        "warn",
        "Discovery timeout reached in analyzeSelectedNeuronsForHarmfulRemoval",
      );
      logAnalysisSkipped(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        this.lastNeuronScanStats,
      );
      logFocusSelectionDetailsImpl(
        this.loggingEnabled,
        this.discoveryID,
        "neuron",
        focusList,
        this.lastFocusSelection,
        focusSelectionKey,
      );
      return undefined;
    }

    return await analyzeHarmfulNeuronsImpl(
      this.creature,
      focusList,
      (neuronIdentifier) => this.loadNeuronRecords(neuronIdentifier),
      this.tempDir,
      this.loggingEnabled,
      (level, message, details) => this.log(level, message, details),
    );
  }

  // ── Private delegates for backward-compatible instance access ───────

  private mapRustCandidate(
    candidate: RustCandidateSynapse,
  ): CandidateSynapse {
    return mapRustCandidateImpl(candidate);
  }

  private mapRustNeuronCandidate(
    candidate: RustCandidateNeuron,
  ): CandidateNeuron {
    return mapRustNeuronCandidateImpl(candidate);
  }

  private findCandidateSquash(
    neuronUUID: string,
    records: DiscoverRecord[],
  ): CandidateSquash | undefined {
    return findCandidateSquashImpl(
      this.creature,
      neuronUUID,
      records,
      (uuid, derivativeMap) => this.calculateNeuronImpact(uuid, derivativeMap),
      this.loggingEnabled,
      (level, message, details) => this.log(level, message, details),
    );
  }

  // ── Static application delegates ────────────────────────────────────

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

  public static resetRemovalDiagnostics(): void {
    resetRemovalDiagnosticsImpl();
  }

  public static getRemovalSameUUIDCount(): number {
    return getRemovalSameUUIDCountImpl();
  }

  public getRemovalCandidates():
    | import("./DiscoverResult.ts").RemovalCandidate[]
    | undefined {
    return this.cachedRemovalCandidates;
  }
}
