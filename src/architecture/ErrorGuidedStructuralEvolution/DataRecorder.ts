/**
 * DataRecorder class: orchestrates discovery recording and analysis.
 *
 * Reads binary data files, submits sampled records to the DiscoverStructure
 * for Rust-backed recording, then delegates the analysis phase to
 * DataRecorderAnalysis for candidate discovery.
 */

import { assert } from "@std/assert";
import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { Creature } from "@creature";
import type { NeatConfig } from "@config/NeatConfig.ts";
import { ensureWasmActivation } from "@wasm/mod.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  DiscoverStructure,
  type DiscoverStructureDeps,
  type DiscoverStructureOptions,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { isRustDiscoveryEnabled } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { costNameToTaskDescriptor } from "@costs/CostTaskDescriptor.ts";
import { resolveAnalysisMemoryBudgetMb } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryAnalysisMemory.ts";
import { PhaseDiagnostics } from "@architecture/ErrorGuidedStructuralEvolution/PhaseDiagnostics.ts";
import {
  DiscoveryPerformanceStats,
  shouldLogDiscovery,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import { runRecordingPhase } from "@architecture/ErrorGuidedStructuralEvolution/DataRecorderRecording.ts";
import { runAnalysisLoop } from "@architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts";
import {
  buildEmptyDiscoverResult,
  resolveDegradedAnalysisBoundary,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisExtensionBoundary.ts";
import {
  computeRecordCoverage,
  formatRecordCoverage,
  shouldSkipAnalysisForCoverage,
} from "@architecture/ErrorGuidedStructuralEvolution/RecordCoverage.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/**
 * Issue #1219 - Ensures WASM activation is initialised before discovery recording.
 *
 * Issue #1247 - Delegates to the shared `ensureWasmActivation()` helper so that
 * scoring, evaluation, and discovery all use the same initialisation logic.
 *
 * @throws Error if WASM initialisation fails and is not available
 */
export async function ensureWasmActivationForDiscovery(): Promise<void> {
  await ensureWasmActivation();
}

/**
 * Calculates the candidate counts that should be reported in the worker
 * "Candidates Found" summary.
 *
 * Note (29-Dec-2025): This summary intentionally reports *raw* Rust counts only.
 * Combination candidates are built later by `DiscoveryRunner` **only after**
 * single candidates have been scored and proven to improve. Counting combos here
 * is misleading because it implies extra candidates exist before evaluation.
 */
export function calculateDiscoveryCandidateSummaryCounts(counts: {
  helpfulSynapseRawCount: number;
  helpfulNeuronRawCount: number;
  coordinatedStructuralRawCount: number;
  harmfulSynapseCandidates: number;
  harmfulNeuronCandidates: number;
  squashRawCount: number;
  removalRawCount: number;
}): {
  helpfulSynapses: number;
  helpfulNeurons: number;
  coordinatedStructural: number;
  harmfulSynapses: number;
  harmfulNeurons: number;
  squashChanges: number;
  removalCandidates: number;
} {
  return {
    helpfulSynapses: counts.helpfulSynapseRawCount,
    helpfulNeurons: counts.helpfulNeuronRawCount,
    coordinatedStructural: counts.coordinatedStructuralRawCount,
    harmfulSynapses: counts.harmfulSynapseCandidates,
    harmfulNeurons: counts.harmfulNeuronCandidates,
    squashChanges: counts.squashRawCount,
    removalCandidates: counts.removalRawCount,
  };
}

export async function recordDirectory(
  creature: Creature,
  dataDir: string,
  config: NeatConfig,
  deps: Partial<DiscoverStructureDeps> = {},
) {
  // Issue #1219: Ensure WASM activation is initialised before discovery recording.
  // This allows calling programs to use discovery without explicit WASM init.
  await ensureWasmActivationForDiscovery();

  const recorder = new DataRecorder(creature, config, deps);
  return await recorder.recordDirectory(dataDir);
}

export class DataRecorder {
  private readonly BYTES_PER_RECORD: number;
  private readonly BATCH_SIZE: number;
  private readonly sampleRate: number;
  private readonly discoveryBatchSize: number;
  private readonly ID: string;
  private timeoutTS: number;
  private readonly timeoutSeconds: number;
  private readonly analysisTimeoutSeconds: number;
  private analysisDeadlineAt?: number;
  /**
   * Issue #2898: absolute hard-deadline timestamp (epoch ms) carried across the
   * worker boundary in the per-call config. Clamps every per-discovery deadline
   * to the caller's T+15 cap. `undefined` when no `timeoutMinutes` is
   * configured, in which case clamping is a no-op (behaviour unchanged).
   */
  private readonly discoveryHardDeadlineTS?: number;
  private readonly discoveryMaxNeurons: number;
  private readonly drainEveryNBatches: number;
  private readonly rustFlushRecords: number;
  private readonly discoverDeps: Partial<DiscoverStructureDeps>;
  private readonly discoverStructureOptions: DiscoverStructureOptions;

  constructor(
    private readonly creature: Creature,
    private readonly config: NeatConfig,
    deps: Partial<DiscoverStructureDeps>,
  ) {
    this.BYTES_PER_RECORD = (creature.input + creature.output) * 4;
    // Config values are concrete - discoveryBufferSize defaults to 0 meaning use 128k
    const discoveryBufferSize = config.discoveryBufferSize || 128 * 1024;
    this.BATCH_SIZE = Math.max(
      1,
      Math.floor(discoveryBufferSize / this.BYTES_PER_RECORD),
    );

    // Config values are concrete with validated defaults
    this.sampleRate = config.discoverySampleRate;
    this.discoveryBatchSize = config.discoveryBatchSize;

    this.ID = CreatureUtil.makeUUID(creature).slice(-8);

    // Config has already applied defaults and validation for timeouts
    const discoveryRecordTimeOutMinutes = Math.min(
      60,
      config.discoveryRecordTimeOutMinutes,
    );
    this.timeoutSeconds = discoveryRecordTimeOutMinutes * 60;
    // Issue #2898: clamp the recording deadline to the absolute hard cap. A
    // request queued behind a busy worker would otherwise anchor its relative
    // budget at start time, not schedule time, drifting the completion past
    // T+15. `min(now + recordBudget, hardDeadline)` ties it back to the cap.
    this.discoveryHardDeadlineTS = config.discoveryHardDeadlineTS;
    this.timeoutTS = Date.now() + this.timeoutSeconds * 1000;
    if (this.discoveryHardDeadlineTS !== undefined) {
      this.timeoutTS = Math.min(this.timeoutTS, this.discoveryHardDeadlineTS);
    }

    const analysisTimeoutMinutes = Math.min(
      60,
      config.discoveryAnalysisTimeoutMinutes,
    );
    this.analysisTimeoutSeconds = analysisTimeoutMinutes * 60;

    this.discoveryMaxNeurons = config.discoveryMaxNeurons;
    this.drainEveryNBatches = config.discoveryDrainEveryNBatches;
    this.rustFlushRecords = config.discoveryRustFlushRecords;
    this.discoverDeps = deps;

    // Build options for DiscoverStructure (debugging/testing features).
    // Issue #2785: map the configured cost name to its structural descriptor
    // so Discovery receives it on recordDiscovery + analyzeParallel. Custom JS
    // costs collapse to the neutral OTHER descriptor inside the mapping helper.
    this.discoverStructureOptions = {
      baseDirectory: config.discoveryBaseDirectory,
      disableCleanup: config.discoveryDisableCleanup,
      skipRecordPhase: config.discoverySkipRecordPhase,
      rustFlushBytesThreshold: config.discoveryRustFlushBytes,
      taskDescriptor: costNameToTaskDescriptor(config.costName),
      // Issue #3432: forward the configured analysis memory budget so Rust
      // enforces a ceiling of its own during `analyze_parallel`. Resolves to
      // `undefined` when unconfigured, which keeps the field off the wire.
      maxAnalysisMemoryMb: resolveAnalysisMemoryBudgetMb(config.memory),
    };
  }

  private shouldAwaitCleanup(): boolean {
    try {
      const explicit = Deno.env.get("NEAT_DISCOVERY_AWAIT_CLEANUP");
      if (explicit) {
        const normalized = explicit.trim().toLowerCase();
        return normalized === "1" || normalized === "true" ||
          normalized === "yes";
      }
      const denoTest = Deno.env.get("DENO_TEST");
      return denoTest?.toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  private shuffleFiles(files: string[]): string[] {
    const rng = getRandomNumberGenerator();
    for (let i = files.length; i--;) {
      const j = Math.floor(rng.random() * (i + 1));
      [files[i], files[j]] = [files[j], files[i]];
    }
    return files;
  }

  private async getBinaryFiles(dataDir: string): Promise<string[]> {
    const binaryFiles: string[] = [];
    const entries = await Array.fromAsync(Deno.readDir(dataDir));

    for (const dirEntry of entries) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".bin")) {
        binaryFiles.push(`${dataDir}/${dirEntry.name}`);
      }
    }

    return this.shuffleFiles(binaryFiles);
  }

  private fp(percentage: number): string {
    return yellow(
      Math.abs(1 - percentage) < Number.EPSILON
        ? "100%"
        : (percentage * 100).toFixed(1) + "%",
    );
  }

  async recordDirectory(dataDir: string): Promise<DiscoverResult> {
    // Check if Rust discovery module is available (library + GPU required)
    // Use dependency injection if provided, otherwise use the public function
    const rustEnabled = this.discoverDeps.isRustDiscoveryEnabled
      ? this.discoverDeps.isRustDiscoveryEnabled()
      : isRustDiscoveryEnabled();
    if (!rustEnabled) {
      if (shouldLogDiscovery(this.config)) {
        getLogger().warn(
          `🔧 Discovery skipped: Rust discovery library not available. ` +
            `Install NEAT-AI-Discovery or set NEAT_AI_DISCOVERY_LIB_PATH.`,
        );
      }
      // Return empty result - discovery is skipped
      return buildEmptyDiscoverResult(this.ID);
    }

    const binaryFiles = await this.getBinaryFiles(dataDir);
    assert(
      binaryFiles.length > 0,
      "No binary files found in the data directory",
    );

    return await this.recordFiles(binaryFiles);
  }

  private async recordFiles(binaryFiles: string[]): Promise<DiscoverResult> {
    const { creature, config } = this;
    const startTime = Date.now();
    const phaseDiagnostics = new PhaseDiagnostics("initialization");
    const perfStats = new DiscoveryPerformanceStats();

    if (shouldLogDiscovery(config)) {
      getLogger().info(
        `Discovery ${
          blue(this.ID)
        } with ${binaryFiles.length} binary files, sample rate: ${
          this.fp(this.sampleRate)
        }, batch size: ${
          yellow(this.discoveryBatchSize.toLocaleString("en-AU"))
        }`,
      );
    }

    const discoverStructure = new DiscoverStructure(
      creature,
      this.timeoutSeconds,
      this.rustFlushRecords,
      this.discoverDeps,
      this.discoverStructureOptions,
    );
    discoverStructure.configureLogging({
      discoveryID: this.ID,
      verbose: shouldLogDiscovery(config),
    });
    const focusOverride = this.config.discoveryFocusNeuronUUIDs;
    if (Array.isArray(focusOverride) && focusOverride.length > 0) {
      discoverStructure.setForcedFocusNeurons(focusOverride);
    }
    const neuronPromisesMap: Map<number, Promise<void>> = new Map();

    const initializeStartTime = Date.now();
    discoverStructure.initialize(neuronPromisesMap);
    const initializeTime = Date.now() - initializeStartTime;
    perfStats.initializationTime = initializeTime;

    // Declare timing variables outside try block for error diagnostics
    let fileProcessTime = 0;

    if (shouldLogDiscovery(config)) {
      getLogger().info(
        `Discovery ${blue(this.ID)} initialize time ${
          yellow(format(initializeTime, { ignoreZero: true }))
        }`,
      );
    }

    // Check if we should skip recording and use existing parquet files
    const skipRecording = discoverStructure.shouldSkipRecording();

    try {
      // --- Recording Phase ---
      const recordingCtx = {
        inputCount: creature.input,
        outputCount: creature.output,
        BYTES_PER_RECORD: this.BYTES_PER_RECORD,
        sampleRate: this.sampleRate,
        discoveryBatchSize: this.discoveryBatchSize,
        timeoutTS: this.timeoutTS,
        drainEveryNBatches: this.drainEveryNBatches,
        config: this.config,
        ID: this.ID,
      };
      const recordingSuccess = await runRecordingPhase(
        recordingCtx,
        binaryFiles,
        discoverStructure,
        neuronPromisesMap,
        phaseDiagnostics,
        perfStats,
        startTime,
        skipRecording,
      );
      fileProcessTime = perfStats.fileProcessingTime;

      if (!recordingSuccess) {
        return buildEmptyDiscoverResult(this.ID);
      }

      // Issue #3073: Record-coverage guard. When recording timed out having
      // sampled too little of the dataset, the focus-neuron Parquet coverage is
      // too sparse for a meaningful analysis pass — running analysis would only
      // burn the analysis budget and produce zero-candidate passes. Skip
      // analysis with a clear reason and return the same empty result shape as
      // the other partial-result paths. Only fires on a genuine timeout that
      // left part of a multi-file dataset unread; complete recordings are
      // unaffected.
      const coverage = computeRecordCoverage({
        recordsProcessed: perfStats.recordsProcessed,
        filesProcessed: perfStats.filesProcessed,
        totalFiles: perfStats.totalFiles,
        timedOut: perfStats.recordTimedOut,
      });
      if (
        shouldSkipAnalysisForCoverage(
          coverage,
          config.discoveryMinRecordCoverage,
        )
      ) {
        getLogger().warn(
          `⏭️  Discovery ${
            blue(this.ID)
          } skipping analysis: record phase timed out with insufficient ` +
            `coverage (${formatRecordCoverage(coverage)}, minimum ${
              (config.discoveryMinRecordCoverage * 100).toFixed(0)
            }%).`,
        );
        await this.runCleanup(discoverStructure, perfStats, startTime);
        return buildEmptyDiscoverResult(this.ID);
      }

      // Issue #3026: Release record-phase JS retainers before sampling the
      // heap at the analysis-extension boundary. The recording phase has
      // already persisted its output (merged parquet + selected_indices.json),
      // so the in-memory sample accumulators and per-file index map are dead
      // weight on the small default worker V8 heap. Dropping them here lowers
      // the heap sample the guard reads — the #2642 chunk-cache release applied
      // to the record→analysis handoff — without touching analysis-needed
      // state or recorded output.
      discoverStructure.releaseRecordingRetainers({
        attemptGc: this.config.memory.proactiveGc,
      });

      // Issue #2594/#3025/#3296: Heap-aware extension boundary — degrade, don't
      // abort. Before extending the timeout for analysis, sample the heap. If
      // the off-heap-aware guard reports CRITICAL pressure here (genuine
      // budget exhaustion), the historical response was to skip analysis and
      // return an empty, 0-candidate result. Issue #3296 replaces that abort
      // with degrade-and-continue: reduce the analysis footprint (fewer focus
      // neurons, smaller Rust FFI chunks) and push through to a genuine
      // completion instead. The degrade decision is logged with the reduced
      // knob values so the smaller footprint is observable. A worker-default
      // heap CRITICAL with native-budget headroom is not degraded — the happy
      // path is untouched (`degraded === false`).
      const boundary = resolveDegradedAnalysisBoundary(
        this.ID,
        this.config.memory,
        getLogger(),
        {
          discoveryMaxNeurons: this.discoveryMaxNeurons,
          analysisChunkSize: this.config.discoveryAnalysisChunkSize,
        },
      );
      const analysisMaxNeurons = boundary.knobs.discoveryMaxNeurons;
      const analysisChunkSize = boundary.knobs.analysisChunkSize;

      // Extend timeout for analysis phase (clamped to the hard deadline)
      const analysisTimeoutMinutes = this.extendTimeoutForAnalysisPhase(
        discoverStructure,
      );

      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${blue(this.ID)} analysis timeout extended by ${
            yellow(analysisTimeoutMinutes.toString())
          }m`,
        );
      }

      // --- Analysis Phase ---
      const discoverResult = await runAnalysisLoop(
        {
          ID: this.ID,
          config: this.config,
          discoveryMaxNeurons: analysisMaxNeurons,
          costOfGrowth: this.config.costOfGrowth,
          analysisChunkSize: analysisChunkSize,
          perChunkMaxMs: this.config.discoveryAnalysisPerChunkMaxMs,
          getTimeoutTS: () => this.timeoutTS,
          refreshAnalysisTimeout: (ds) => this.refreshAnalysisTimeout(ds),
          // #3296: when the boundary degraded under memory pressure, run at
          // least one minimal-footprint pass before the in-loop heap guard may
          // abort — so a starved host reaches a genuine completion instead of a
          // zero-candidate abort at the very first iteration.
          degradedFirstPass: boundary.degraded,
        },
        discoverStructure,
        perfStats,
        phaseDiagnostics,
      );

      // --- Cleanup Phase ---
      phaseDiagnostics.enterPhase("complete");
      if (shouldLogDiscovery(config)) {
        const totalTime = Date.now() - startTime;
        getLogger().info(
          `Discovery ${blue(this.ID)} analysis complete, total time ${
            yellow(format(totalTime, { ignoreZero: true }))
          }, starting cleanup...`,
        );
      }

      await this.runCleanup(discoverStructure, perfStats, startTime);

      // Candidate counts must reflect what we actually return
      perfStats.helpfulSynapseCount =
        discoverResult.addHelpfulSynapses?.length ?? 0;
      perfStats.helpfulNeuronCount = discoverResult.addHelpfulNeurons?.length ??
        0;
      perfStats.coordinatedStructuralCount =
        discoverResult.coordinatedStructuralCandidates?.length ?? 0;
      perfStats.harmfulSynapseCount = discoverResult.removeHarmfulSynapse
        ? 1
        : 0;
      perfStats.harmfulNeuronCount =
        discoverResult.removeHarmfulNeurons?.length ?? 0;
      perfStats.squashCount = discoverResult.candidateSquashes?.length ?? 0;
      perfStats.removalCount = discoverResult.removalCandidates?.length ?? 0;

      perfStats.logSummary(this.ID, config);

      return discoverResult;
    } catch (error) {
      // On error, show diagnostics unconditionally (indicates a bug)
      const totalTime = Date.now() - startTime;
      getLogger().error(
        `❌ DISCOVERY ERROR for ${blue(this.ID)} after ${
          format(totalTime, { ignoreZero: true })
        }:`,
      );
      getLogger().error(`   Error: ${error}`);
      const phaseSnapshot = phaseDiagnostics.snapshot();
      getLogger().error(`   Current phase: ${phaseSnapshot.currentPhase}`);
      if (phaseSnapshot.parallelPhases.length > 0) {
        getLogger().error(
          `   Active analysis phases: ${
            phaseSnapshot.parallelPhases.join(", ")
          }`,
        );
      }
      getLogger().error(`   Phase timing diagnostics:`);
      getLogger().error(
        `     - Initialize: ${format(initializeTime, { ignoreZero: true })}`,
      );
      getLogger().error(
        `     - File processing: ${
          format(fileProcessTime, { ignoreZero: true })
        }`,
      );
      getLogger().error(
        `     - Total: ${format(totalTime, { ignoreZero: true })}`,
      );

      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${blue(this.ID)} error occurred, performing cleanup...`,
        );
      }
      try {
        await discoverStructure.cleanUp();
        if (shouldLogDiscovery(config)) {
          getLogger().info(`Discovery ${blue(this.ID)} cleanup complete.`);
        }
      } catch (cleanupError) {
        getLogger().error(
          `❌ WARNING: Discovery ${this.ID} cleanup failed after error:`,
          cleanupError,
        );
        // Don't throw - preserve the original error
      }
      throw error;
    }
  }

  /**
   * Handles cleanup after analysis, either synchronously or asynchronously.
   */
  private async runCleanup(
    discoverStructure: DiscoverStructure,
    perfStats: DiscoveryPerformanceStats,
    startTime: number,
  ): Promise<void> {
    const { config } = this;
    const cleanupStartTime = Date.now();
    const cleanupPromise = (async () => {
      if (shouldLogDiscovery(config)) {
        getLogger().info(`Discovery ${blue(this.ID)} performing cleanup...`);
      }
      await discoverStructure.cleanUp();
      perfStats.cleanupTime = Date.now() - cleanupStartTime;
      if (shouldLogDiscovery(config)) {
        getLogger().info(`Discovery ${blue(this.ID)} cleanup complete.`);
      }
    })();

    if (this.shouldAwaitCleanup()) {
      await cleanupPromise;
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${blue(this.ID)} cleanup awaited and complete (${
            format(perfStats.cleanupTime, { ignoreZero: true })
          }).`,
        );
      }
    } else {
      cleanupPromise.catch((error) => {
        getLogger().error(
          `❌ CRITICAL: Discovery ${this.ID} cleanup failed - potential resource leak:`,
          error,
        );
      });
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${
            blue(this.ID)
          } cleanup scheduled (async, non-blocking - results will be returned immediately).`,
        );
      }
      perfStats.cleanupTime = 0;
    }

    perfStats.totalTime = Date.now() - startTime;
  }

  /**
   * Move from recording into analysis, extending the deadline by the configured
   * analysis budget but never past the absolute hard deadline (Issue #2898).
   *
   * `analysisDeadlineAt = min(now + analysisBudget, discoveryHardDeadlineTS)`.
   * The same clamped value is pushed into the DiscoverStructure (which also
   * remembers the cap for later `refreshAnalysisTimeout` top-ups) and mirrored
   * onto `this.timeoutTS`, which the analysis loop reads via `getTimeoutTS()`.
   *
   * @returns the analysis budget in minutes, for logging.
   */
  extendTimeoutForAnalysisPhase(discoverStructure: DiscoverStructure): number {
    const analysisTimeoutSeconds = this.analysisTimeoutSeconds;
    let analysisDeadlineAt = Date.now() + analysisTimeoutSeconds * 1000;
    if (this.discoveryHardDeadlineTS !== undefined) {
      analysisDeadlineAt = Math.min(
        analysisDeadlineAt,
        this.discoveryHardDeadlineTS,
      );
    }
    this.analysisDeadlineAt = analysisDeadlineAt;
    discoverStructure.extendTimeoutForAnalysis(
      analysisTimeoutSeconds,
      this.discoveryHardDeadlineTS,
    );
    this.timeoutTS = analysisDeadlineAt;
    return analysisTimeoutSeconds / 60;
  }

  refreshAnalysisTimeout(
    discoverStructure: DiscoverStructure,
  ): void {
    if (this.analysisDeadlineAt === undefined) {
      return;
    }
    const remainingMs = this.analysisDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      return;
    }
    const remainingSeconds = Math.max(1, Math.floor(remainingMs / 1000));
    // Issue #2898: re-supply the hard cap so the top-up can never overshoot it,
    // even though `analysisDeadlineAt` is already clamped.
    discoverStructure.extendTimeoutForAnalysis(
      remainingSeconds,
      this.discoveryHardDeadlineTS,
    );
    this.timeoutTS = this.analysisDeadlineAt;
  }

  /** Current recording/analysis deadline (epoch ms). Issue #2898 — test seam. */
  get currentTimeoutTS(): number {
    return this.timeoutTS;
  }

  /** Clamped analysis deadline (epoch ms), once analysis has begun. Issue #2898. */
  get currentAnalysisDeadlineAt(): number | undefined {
    return this.analysisDeadlineAt;
  }
}
