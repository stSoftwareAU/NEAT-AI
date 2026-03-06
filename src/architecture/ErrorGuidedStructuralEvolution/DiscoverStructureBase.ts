/**
 * Base class for DiscoverStructure: fields, constructor, lifecycle, and helpers.
 *
 * This base class holds the shared state and lifecycle methods for the
 * Error-Driven Structural Discovery coordinator. Recording and analysis
 * methods are added by subclasses.
 */

import { assert } from "@std/assert";
import type { Creature } from "../../Creature.ts";
import { isWasmActivationAvailable } from "../../wasm/mod.ts";
import type { CreatureErrorImpactEstimator } from "../../discovery/NeuronErrorImpactEstimator.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import {
  analyzeParallel,
  isRustDiscoveryEnabled,
  isRustLibraryAvailable,
  mergeDiscoveryParquet,
  rankFocusNeurons,
  readDiscoveryRecords,
  recordDiscovery,
} from "./RustDiscovery.ts";
import {
  DEFAULT_RUST_FLUSH_BYTES,
  DEFAULT_RUST_FLUSH_RECORDS,
} from "./constants.ts";
import { emptyDirSync, ensureDirSync } from "@std/fs";
import {
  cleanOrphanedDiscoveryDirs,
  createDiscoveryLockFile,
  removeDiscoveryLockFile,
} from "../../discovery/DiscoveryCleanup.ts";
import type {
  BinaryRecordIndices,
  DiscoverRecord,
  DiscoverStructureOptions,
  FocusSelectionSummary,
  NeuronImpactInfo,
  NeuronScanStats,
} from "./DiscoverStructureTypes.ts";
import {
  truncateForLogValue as truncateForLogValueImpl,
} from "./RustFlushDiagnostics.ts";
import { getLogger } from "../../utils/Logger.ts";
import { logDiscoveryDiskUsage } from "../../discovery/DiskSpaceMonitor.ts";

import { logDiscovery } from "./DiscoverLogging.ts";
import { loadNeuronRecords } from "./DiscoverDataLoading.ts";
import { calculateNeuronImpact, listNeuronsByImpact } from "./NeuronImpact.ts";
import type { CombinedAnalysisCache } from "./RustAnalysisCache.ts";
import type {
  CandidateNeuron,
  CandidateSynapse,
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
 * Base class holding the shared state, constructor, lifecycle, and helper
 * methods for the DiscoverStructure coordinator.
 *
 * Fields are `protected` so that subclasses (Recording, Analysis) can
 * access them directly.
 */
export class DiscoverStructureBase {
  protected creature: Creature;
  protected tempDir: string;
  protected textDecoder: TextDecoder;
  protected timeoutTS: number;
  protected loggingEnabled = false;
  protected discoveryID: string;

  protected initialized = false;
  protected recorded = false;

  protected selectedIndices: BinaryRecordIndices = {};
  protected indicesFilePath: string;

  // Rust recording state
  protected rustAccumulatedData: DataRecordInterface[] = [];
  protected rustAccumulatedNeuronData: Array<Map<string, DiscoverRecord>> = [];
  protected rustAccumulatedEstimatedBytes = 0;
  protected rustEstimatedBytesPerSample = 0;
  protected rustBinaryFilePath: string | null = null;
  protected rustBinaryFilePaths: Set<string> = new Set();
  protected usingRustDualWrite = false;
  protected parquetFilePath: string | null = null;
  protected rustFlushRecords: number;
  protected rustFlushBytesThreshold: number;
  protected rustChunkFiles: string[] = [];
  protected rustChunkCounter = 0;
  protected syntheticBinaryMode = false;
  protected deps: DiscoverStructureDeps;
  protected forcedFocusNeurons: string[] | null = null;
  protected forcedFocusIndex = 0;
  protected neuronImpactEstimator?: CreatureErrorImpactEstimator;
  protected neuronIndexMap?: Map<string, number>;
  protected lastFocusSelection?: FocusSelectionSummary;
  protected cachedMaxOutputError?: { value: number; computedAt: number } =
    undefined;
  protected lastNeuronScanStats?: NeuronScanStats;
  protected analysisDeadlineMs?: number;
  protected cachedRemovalCandidates?:
    import("./DiscoverResult.ts").RemovalCandidate[];
  protected combinedRustAnalysis?: CombinedAnalysisCache;
  protected recordedNeuronTotalAbsError = new Map<string, number>();
  protected analysisTimeoutGuardEnabled = true;
  protected disableCleanup = false;
  protected skipRecordPhase = false;

  protected discoveries: CandidateSynapse[] = [];
  protected neuronDiscoveries: CandidateNeuron[] = [];

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

    // Clean up orphaned directories from previous crashed processes
    // before creating our own temp directory.
    try {
      cleanOrphanedDiscoveryDirs(baseDir);
    } catch {
      // Non-critical — log and continue if cleanup fails
    }

    if (this.skipRecordPhase) {
      ensureDirSync(this.tempDir);
    } else {
      emptyDirSync(this.tempDir);
    }

    // Create a lock file so other processes can identify this directory as active
    createDiscoveryLockFile(this.tempDir);

    // Issue #1703: Log disk usage at discovery start
    logDiscoveryDiskUsage(this.tempDir, "discovery start");
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

    // Issue #1703: Log disk usage before cleanup
    logDiscoveryDiskUsage(this.tempDir, "before cleanup");

    // Remove lock file before directory removal
    removeDiscoveryLockFile(this.tempDir);

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

  protected isSelectableNeuronType(neuronType: string | undefined): boolean {
    return neuronType !== "input" && neuronType !== "constant";
  }

  protected isSelectableNeuron(neuron: { type: string }): boolean {
    return this.isSelectableNeuronType(neuron.type);
  }

  protected log(
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

  protected truncateForLog(value: string, max = 120): string {
    return truncateForLogValueImpl(value, max);
  }

  // ── Output error cache ──────────────────────────────────────────────

  protected async measureMaxOutputError(): Promise<number> {
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

  protected async getMaxOutputError(): Promise<number> {
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

  // ── Data loading (delegates) ────────────────────────────────────────

  protected loadNeuronRecords(
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

  protected calculateNeuronImpact(
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

  // ── Wasm activation check (used by recording) ──────────────────────

  protected assertWasmActivation(): void {
    assert(
      isWasmActivationAvailable(),
      "WASM activation must be initialised before discovery recording",
    );
  }
}
