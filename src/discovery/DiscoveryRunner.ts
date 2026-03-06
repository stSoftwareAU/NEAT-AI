import { assertExists } from "@std/assert";
import { getLogger } from "../utils/Logger.ts";
import { format } from "@std/fmt/duration";
import { ConfigurationError } from "../errors/ConfigurationError.ts";
import { DiscoveryError } from "../errors/DiscoveryError.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { isRustDiscoveryEnabled } from "../architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { Creature } from "../Creature.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import {
  filterCandidatesForEvaluation,
  logFilteringDiagnostics,
} from "./CandidateFiltering.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import {
  buildCombinedFromSuccessful,
  buildDiscoveryCandidates,
  type BuildDiscoveryCandidatesOptions,
  type DiscoveryChangeType,
  pruneSuccessfulCandidatesForCombos,
} from "./DiscoveryCandidates.ts";
import {
  logEvaluationSummary,
  recordEvaluationSummaries,
} from "./DiscoveryEvaluationSummary.ts";
import {
  cacheEvaluationResults,
  evaluateDiscoveryTasks,
} from "./DiscoveryRunnerEvaluation.ts";
import type {
  DiscoveryDirInput,
  DiscoveryDirResult,
  DiscoveryRunnerDeps,
  DiscoveryRunnerWorker,
  DiscoveryRunnerWorkerFactory,
} from "./DiscoveryRunnerTypes.ts";
import { preFlightDiskSpaceCheck } from "./DiskSpaceMonitor.ts";
import { isCandidateCachedSync } from "./FailureCache.ts";

// Re-export types and functions that external consumers import from this module.
export type { DiscoveryEvaluationSummary } from "./DiscoveryEvaluationSummary.ts";
export {
  formatErrorDelta,
  formatPercentWithSignificantDigits,
} from "./DiscoveryFormatting.ts";
export {
  filterCandidatesForEvaluation,
  type FilterCandidatesForEvaluationDeps,
  type FilterCandidatesForEvaluationDiagnostics,
  weightedSampleWithoutReplacement,
} from "./CandidateFiltering.ts";
export type {
  DiscoveryDirInput,
  DiscoveryDirResult,
  DiscoveryRunnerDeps,
  DiscoveryRunnerLike,
  DiscoveryRunnerWorker,
  DiscoveryRunnerWorkerFactory,
  DiscoveryRunnerWorkerFactoryArgs,
} from "./DiscoveryRunnerTypes.ts";

const DEFAULT_WORKER_FACTORY: DiscoveryRunnerWorkerFactory = (args) =>
  new WorkerHandler(
    args.dataDir,
    args.costName,
    args.direct,
    args.customCost,
    args.wasmCache,
  );

const DEFAULT_RUST_CHECK = () => isRustDiscoveryEnabled();

export class DiscoveryRunner {
  #workerFactory: DiscoveryRunnerWorkerFactory;
  #candidateBuilder: (
    creature: Creature,
    discovery: DiscoverResult,
    options?: BuildDiscoveryCandidatesOptions,
  ) => DiscoveryCandidate[];
  #rustDiscoveryEnabled: () => boolean;

  constructor(deps: DiscoveryRunnerDeps = {}) {
    this.#workerFactory = deps.workerFactory ?? DEFAULT_WORKER_FACTORY;
    this.#candidateBuilder = deps.candidateBuilder ?? buildDiscoveryCandidates;
    this.#rustDiscoveryEnabled = deps.rustDiscoveryEnabled ??
      DEFAULT_RUST_CHECK;
  }

  async discoverDir(input: DiscoveryDirInput): Promise<DiscoveryDirResult> {
    // Discovery requires both library and GPU - skip if not available
    if (!this.#rustDiscoveryEnabled()) {
      throw new DiscoveryError(
        "Discovery requires the NEAT-AI-Discovery Rust library to be available and a GPU to be present. " +
          "Discovery is disabled when either the library or GPU is unavailable.",
        "LIBRARY_NOT_FOUND",
      );
    }

    const { creature, dataDir } = input;
    const config = createNeatConfig(input.options);
    const verboseLog = (...args: unknown[]) => {
      if (config.verbose) {
        getLogger().info("[DiscoveryRunner]", ...args);
      }
    };
    if (config.discoverySampleRate <= 0) {
      throw new ConfigurationError(
        "Discovery requires a positive discoverySampleRate.",
        "OUT_OF_RANGE",
      );
    }
    if (config.discoveryRecordTimeOutMinutes <= 0) {
      throw new ConfigurationError(
        "Discovery requires a positive discoveryRecordTimeOutMinutes setting.",
        "OUT_OF_RANGE",
      );
    }

    // Issue #1703: Pre-flight disk space check before starting discovery
    if (config.discoveryDiskSpace.enabled) {
      const baseDir = config.discoveryBaseDirectory ?? ".discovery";
      const canProceed = preFlightDiskSpaceCheck(
        baseDir,
        config.discoveryDiskSpace.minFreeDiskMB,
        config.discoveryDiskSpace.criticalFreeDiskMB,
      );
      if (!canProceed) {
        throw new DiscoveryError(
          "Discovery aborted due to critically low disk space. " +
            `Free disk space is below ${config.discoveryDiskSpace.criticalFreeDiskMB} MB threshold. ` +
            "Free up disk space or adjust discoveryDiskSpace.criticalFreeDiskMB.",
          "DISK_SPACE_CRITICAL",
        );
      }
    }

    CreatureUtil.makeUUID(creature);

    const verboseLogging = Boolean(config.verbose);
    const runStart = performance.now();
    const markPhase = (label: string, startedAt: number) => {
      if (!verboseLogging) return;
      const duration = performance.now() - startedAt;
      verboseLog(`${label} completed in ${duration.toFixed(1)} ms.`);
    };
    // Use config.threads which defaults to navigator.hardwareConcurrency (number of CPU cores)
    // This is validated to be >= 1 in createNeatConfig, so no need for Math.max here
    const workerCount = config.threads;
    const workers: DiscoveryRunnerWorker[] = [];
    try {
      const workersStart = performance.now();
      for (let i = 0; i < workerCount; i++) {
        const preferDirect = workerCount === 1;
        // Issue #1567: Propagate WASM cache limits to worker threads.
        let worker = this.#workerFactory({
          dataDir,
          costName: config.costName,
          direct: preferDirect,
          customCost: config.customCost,
          wasmCache: config.wasmCache,
        });
        // Avoid a cold-cache download storm by warming workers sequentially when supported.
        // (Custom workerFactory implementations may not expose this method.)
        if (typeof worker.waitUntilReady === "function") {
          try {
            // deno-lint-ignore no-await-in-loop
            await worker.waitUntilReady();
          } catch (err) {
            try {
              worker.terminate();
            } catch {
              // Swallow termination errors as worker may already be closed.
            }
            if (!preferDirect) {
              getLogger().warn(
                "[DiscoveryRunner] Worker init failed; falling back to direct execution for this worker slot.",
                err,
              );
              worker = this.#workerFactory({
                dataDir,
                costName: config.costName,
                direct: true,
                customCost: config.customCost,
                wasmCache: config.wasmCache,
              });
              if (typeof worker.waitUntilReady === "function") {
                // deno-lint-ignore no-await-in-loop
                await worker.waitUntilReady();
              }
            } else {
              throw err;
            }
          }
        }
        // Only add to the pool once initialization succeeded (or is not supported).
        workers.push(worker);
      }
      markPhase("Worker initialisation", workersStart);

      // Use the config directly - it's already frozen and concrete
      // If verbose is enabled but log is 0, enable logging for discovery
      const workerConfig: NeatConfig = (config.log > 0 || !config.verbose)
        ? config
        : createNeatConfig({ ...config, log: 1 });

      verboseLog(
        `Starting discovery for creature ${creature.uuid ?? "unknown"} using ${
          workerCount === 1 ? "single" : workerCount
        } worker${workerCount === 1 ? "" : "s"}.`,
      );

      const discoveryStart = performance.now();
      const discoveryResponse = await workers[0].discover(
        creature,
        workerConfig,
      );
      const rawDiscover = discoveryResponse.discover as
        | DiscoverResult
        | undefined;
      assertExists(
        rawDiscover,
        "Worker did not return discovery results.",
      );
      const discoverResult: DiscoverResult = {
        ID: rawDiscover.ID,
        addHelpfulSynapses: rawDiscover.addHelpfulSynapses ?? undefined,
        addHelpfulNeurons: rawDiscover.addHelpfulNeurons ?? undefined,
        coordinatedStructuralCandidates:
          rawDiscover.coordinatedStructuralCandidates ?? undefined,
        removeHarmfulSynapse: rawDiscover.removeHarmfulSynapse ?? undefined,
        removeHarmfulNeurons: rawDiscover.removeHarmfulNeurons ?? undefined,
        removalCandidates: rawDiscover.removalCandidates ?? undefined,
        candidateSquashes: rawDiscover.candidateSquashes ?? undefined,
        reScoringTime: undefined, // Will be set after re-scoring completes
      };

      const addCount = discoverResult.addHelpfulSynapses?.length ?? 0;
      const neuronCount = discoverResult.addHelpfulNeurons?.length ?? 0;
      const removePresent = discoverResult.removeHarmfulSynapse ? 1 : 0;
      const squashCount = discoverResult.candidateSquashes?.length ?? 0;
      verboseLog(
        `Discovery ${discoverResult.ID} suggested ${addCount} add, ${neuronCount} neuron, ${removePresent} remove, ${squashCount} squash candidate(s).`,
      );
      markPhase("Discovery phase", discoveryStart);

      // ======================================================================
      // TWO-PHASE DISCOVERY SCORING
      // ======================================================================
      // Phase 1: Build and evaluate SINGLE candidates (no combos)
      // Phase 2: Combine only successful candidates and evaluate combos
      // ======================================================================

      const candidateBuildStart = performance.now();

      // Phase 1: Build single candidates only (skip combined candidates)
      const singleCandidates = this.#candidateBuilder(
        creature,
        discoverResult,
        {
          skipCombinedCandidates: true,
          discoveryFailureCacheDir: config.discoveryFailureCacheDir,
        },
      );

      // Log candidate counts by type (always, not just verbose)
      const candidateCountsByType = new Map<string, number>();
      for (const candidate of singleCandidates) {
        const type = candidate.change.type;
        candidateCountsByType.set(
          type,
          (candidateCountsByType.get(type) ?? 0) + 1,
        );
      }
      const countBreakdown = Array.from(candidateCountsByType.entries())
        .map(([type, count]) => `${type}: ${count}`)
        .join(", ");
      getLogger().info(
        `[DiscoveryRunner] Built ${singleCandidates.length} candidate${
          singleCandidates.length === 1 ? "" : "s"
        }${countBreakdown ? ` (${countBreakdown})` : ""}`,
      );

      verboseLog(
        `[Phase 1] Built ${singleCandidates.length} single candidate creature${
          singleCandidates.length === 1 ? "" : "s"
        }: ${singleCandidates.map((c) => c.change.type).join(", ") || "none"}.`,
      );

      // Get failure cache directory for statistics and filtering
      const failureCacheDir = config.discoveryFailureCacheDir;

      const { filtered: filteredSingleCandidates, skipped } = this
        .#filterCandidatesForEvaluation(
          singleCandidates,
          workerCount,
          config,
          failureCacheDir,
        );
      if (skipped.length > 0) {
        // Group skipped candidates by type for a cleaner summary
        const skippedByType = new Map<string, number>();
        for (const entry of skipped) {
          const type = entry.changeType ?? "unknown";
          skippedByType.set(type, (skippedByType.get(type) ?? 0) + 1);
        }
        const typeBreakdown = Array.from(skippedByType.entries())
          .map(([type, count]) => `${count} ${type}`)
          .join(", ");
        verboseLog(
          `Skipped ${skipped.length} candidate${
            skipped.length === 1 ? "" : "s"
          } due to slot limits: ${typeBreakdown}.`,
        );
      }

      markPhase("Candidate synthesis (Phase 1)", candidateBuildStart);

      // Phase 1 evaluation: Score single candidates + original
      // Note: Cached candidates are already filtered out in #filterCandidatesForEvaluation
      const phase1Tasks: Array<{
        kind: "original" | "candidate";
        creature: Creature;
        candidate?: DiscoveryCandidate;
      }> = [
        { kind: "original", creature },
        ...filteredSingleCandidates.map((candidate) => ({
          kind: "candidate" as const,
          creature: candidate.creature,
          candidate,
        })),
      ];

      const phase1Start = performance.now();
      const phase1Results = await evaluateDiscoveryTasks(
        workers,
        phase1Tasks,
        config.feedbackLoop,
        config.costOfGrowth,
        verboseLogging,
      );
      const phase1Time = performance.now() - phase1Start;
      markPhase("Phase 1 evaluation (singles)", phase1Start);

      const original = phase1Results.find((result) =>
        result.kind === "original"
      );
      assertExists(original, "Original creature was not evaluated");

      // Find successful single candidates (improved score)
      const successfulSingles = phase1Results
        .filter((result) => result.kind === "candidate")
        .filter((result) => result.score > original.score);

      verboseLog(
        `[Phase 1] Found ${successfulSingles.length} successful single candidate${
          successfulSingles.length === 1 ? "" : "s"
        } out of ${phase1Tasks.length - 1} evaluated.`,
      );

      // Phase 2: Build and evaluate combined candidates from successful singles
      let phase2Results: typeof phase1Results = [];
      let phase2Time = 0;

      if (successfulSingles.length >= 2) {
        const phase2Start = performance.now();

        // Extract successful candidates for combination and prune to a sensible
        // best-per-slot set (eg. avoid combining multiple alternatives that target
        // the same from→to add-neuron slot).
        const scoredSuccessfulCandidates = successfulSingles
          .map((result) => ({
            candidate: result.candidate,
            scoreDelta: result.score - original.score,
          }))
          .filter((entry): entry is {
            candidate: DiscoveryCandidate;
            scoreDelta: number;
          } => entry.candidate !== undefined);

        const successfulCandidates = pruneSuccessfulCandidatesForCombos(
          scoredSuccessfulCandidates,
        );

        // Build combined candidates from successful singles only
        const combinedCandidates = buildCombinedFromSuccessful(
          creature,
          discoverResult.ID,
          successfulCandidates,
        );

        if (combinedCandidates.length > 0) {
          verboseLog(
            `[Phase 2] Built ${combinedCandidates.length} combined candidate${
              combinedCandidates.length === 1 ? "" : "s"
            } from ${successfulSingles.length} successful singles.`,
          );

          // Filter combined candidates (apply same thresholds)
          const { filtered: thresholdFilteredCombos } = this
            .#filterCandidatesForEvaluation(
              combinedCandidates,
              workerCount,
              config,
              failureCacheDir,
            );

          // Note: Cached candidates are already filtered out in #filterCandidatesForEvaluation
          if (thresholdFilteredCombos.length > 0) {
            const phase2Tasks = thresholdFilteredCombos.map((candidate) => ({
              kind: "candidate" as const,
              creature: candidate.creature,
              candidate,
            }));

            phase2Results = await evaluateDiscoveryTasks(
              workers,
              phase2Tasks,
              config.feedbackLoop,
              config.costOfGrowth,
              verboseLogging,
            );
          }
        }

        phase2Time = performance.now() - phase2Start;
        markPhase("Phase 2 evaluation (combos)", phase2Start);
      } else {
        verboseLog(
          `[Phase 2] Skipped - need 2+ successful singles for combination (found ${successfulSingles.length}).`,
        );
      }

      // Combine all evaluation results
      const evaluationResults = [...phase1Results, ...phase2Results];
      const reScoringTime = phase1Time + phase2Time;

      // Find the best improvement across all candidates (single and combined)
      const improved = evaluationResults
        .filter((result) => result.kind === "candidate")
        .filter((result) => result.score > original.score)
        .sort((a, b) => b.score - a.score)[0];

      // Cache successful and failed candidates to their respective caches
      cacheEvaluationResults({
        evaluationResults,
        originalScore: original.score,
        originalError: original.error,
        baseCreature: creature,
        successCacheDir: config.discoverySuccessCacheDir,
        failureCacheDir,
        verbose: verboseLogging,
        discoveryCacheConfig: config.discoveryCache,
      });

      // Update discoverResult with re-scoring time for potential use in summary
      discoverResult.reScoringTime = reScoringTime;

      const outcome: DiscoveryDirResult = {
        discovery: discoverResult,
        original: {
          error: original.error,
          score: original.score,
        },
        reScoringTime,
      };

      if (improved && improved.candidate) {
        const scoreDelta = improved.score - original.score;
        const description = improved.candidate.change.description
          ? improved.candidate.change.description
          : improved.candidate.change.type;
        const changeType = improved.candidate.change.type;
        // Concise message format: description already conveys the change type via emoji and text
        // Score delta uses toPrecision(6) for consistency with other metrics
        const message = `${description} for ${discoverResult.ID}: Score +${
          scoreDelta.toPrecision(6)
        } -> ${improved.score.toPrecision(6)}`;

        outcome.improvement = {
          changeType,
          error: improved.error,
          score: improved.score,
          scoreDelta,
          message,
          creature: improved.candidate.creature.exportJSON(),
        };
      }

      const evaluationArtifacts = recordEvaluationSummaries({
        discoveryID: discoverResult.ID,
        evaluationResults,
        originalScore: original.score,
        originalError: original.error,
        baseCreature: creature,
      });
      if (evaluationArtifacts.summaries.length > 0) {
        outcome.evaluations = evaluationArtifacts.summaries;
      }
      if (evaluationArtifacts.archiveDir) {
        outcome.candidateArchiveDir = evaluationArtifacts.archiveDir;
      }
      if (!config.discoveryDisableEvaluationSummaryLogging) {
        logEvaluationSummary({
          discoveryID: discoverResult.ID,
          summaries: evaluationArtifacts.summaries,
        });
      }

      if (verboseLogging && reScoringTime > 0) {
        const formattedTime = format(reScoringTime, { ignoreZero: true });
        const totalCandidates = evaluationResults.length - 1; // Exclude original
        const phase1Count = phase1Tasks.length - 1;
        const phase2Count = phase2Results.length;
        verboseLog(
          `Re-scoring complete: ${formattedTime} total (${totalCandidates} candidate${
            totalCandidates === 1 ? "" : "s"
          } evaluated: ${phase1Count} single${
            phase2Count > 0 ? ` + ${phase2Count} combo` : ""
          })`,
        );
      }

      markPhase("Total discoveryDir run", runStart);
      return outcome;
    } finally {
      for (const worker of workers) {
        try {
          worker.terminate();
        } catch {
          // Swallow termination errors as workers may already be closed.
        }
      }
    }
  }

  #filterCandidatesForEvaluation(
    candidates: DiscoveryCandidate[],
    threadCount: number,
    config: NeatConfig,
    failureCacheDir?: string,
  ): {
    filtered: DiscoveryCandidate[];
    skipped: Array<{
      changeType?: DiscoveryChangeType;
      expected?: number;
    }>;
  } {
    // Ensure candidate creatures have UUIDs before failure-cache lookups.
    for (const candidate of candidates) {
      CreatureUtil.makeUUID(candidate.creature);
    }

    const result = filterCandidatesForEvaluation(
      candidates,
      threadCount,
      config,
      {
        failureCacheDir,
        isCandidateCached: isCandidateCachedSync,
        random: Math.random,
      },
    );

    logFilteringDiagnostics(result.diagnostics, failureCacheDir);

    return { filtered: result.filtered, skipped: result.skipped };
  }
}
