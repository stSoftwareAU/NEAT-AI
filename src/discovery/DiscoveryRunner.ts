import { assert, assertExists } from "@std/assert";
import { bold, cyan, green, red, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { join } from "@std/path/join";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { isRustDiscoveryEnabled } from "../architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import type { CostName } from "../Costs.ts";
import type { Creature } from "../Creature.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import {
  buildCombinedFromSuccessful,
  buildDiscoveryCandidates,
  type BuildDiscoveryCandidatesOptions,
  type DiscoveredNeuronDetails,
  type DiscoveryChangeType,
  pruneSuccessfulCandidatesForCombos,
  shortID,
} from "./DiscoveryCandidates.ts";
import { isCandidateCachedSync, recordFailureSync } from "./FailureCache.ts";
import { recordSuccessSync } from "./SuccessCache.ts";

export interface DiscoveryRunnerWorker {
  discover(
    creature: Creature,
    options: NeatOptions,
  ): Promise<Awaited<ReturnType<WorkerHandler["discover"]>>>;
  evaluate(
    creature: Creature,
    feedbackLoop: boolean,
  ): Promise<Awaited<ReturnType<WorkerHandler["evaluate"]>>>;
  terminate(): void;
}

export interface DiscoveryRunnerWorkerFactoryArgs {
  dataDir: string;
  costName: CostName;
  direct: boolean;
  customCost?: { filePath: string };
}

export type DiscoveryRunnerWorkerFactory = (
  args: DiscoveryRunnerWorkerFactoryArgs,
) => DiscoveryRunnerWorker;

export interface DiscoveryRunnerDeps {
  workerFactory?: DiscoveryRunnerWorkerFactory;
  candidateBuilder?: (
    creature: Creature,
    discovery: DiscoverResult,
    options?: { skipCombinedCandidates?: boolean },
  ) => DiscoveryCandidate[];
  rustDiscoveryEnabled?: () => boolean;
}

const DEFAULT_WORKER_FACTORY: DiscoveryRunnerWorkerFactory = (args) =>
  new WorkerHandler(
    args.dataDir,
    args.costName,
    args.direct,
    args.customCost,
  );

const DEFAULT_RUST_CHECK = () => isRustDiscoveryEnabled();

export interface DiscoveryDirInput {
  creature: Creature;
  dataDir: string;
  options: NeatOptions;
}

export interface DiscoveryEvaluationSummary {
  kind: "original" | "candidate";
  changeType?: DiscoveryChangeType;
  description?: string;
  score: number;
  error: number;
  scoreDelta?: number;
  improved: boolean;
  archivePath?: string;
  errorDelta?: number;
  errorDeltaPct?: number;
  /** Details of discovered neuron (for single neuron candidates). */
  neuronDetails?: DiscoveredNeuronDetails;
}

export interface DiscoveryDirResult {
  discovery: DiscoverResult;
  original: {
    error: number;
    score: number;
  };
  improvement?: {
    changeType: string;
    error: number;
    score: number;
    scoreDelta: number;
    message: string;
    creature: CreatureExport;
  };
  evaluations?: DiscoveryEvaluationSummary[];
  candidateArchiveDir?: string;
  reScoringTime?: number; // Time spent re-scoring candidates (ms)
}

/**
 * Minimal interface for dependency injection in `Creature.discoveryDir()`.
 * Allows substituting the runner in tests without coupling to the full
 * DiscoveryRunner implementation.
 */
export type DiscoveryRunnerLike = {
  discoverDir(input: DiscoveryDirInput): Promise<DiscoveryDirResult>;
};

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
      throw new Error(
        "Discovery requires the NEAT-AI-Discovery Rust library to be available and a GPU to be present. " +
          "Discovery is disabled when either the library or GPU is unavailable.",
      );
    }

    const { creature, dataDir } = input;
    const config = createNeatConfig(input.options);
    const verboseLog = (...args: unknown[]) => {
      if (config.verbose) {
        console.info("[DiscoveryRunner]", ...args);
      }
    };
    if (config.discoverySampleRate <= 0) {
      throw new Error(
        "Discovery requires a positive discoverySampleRate.",
      );
    }
    if (config.discoveryRecordTimeOutMinutes <= 0) {
      throw new Error(
        "Discovery requires a positive discoveryRecordTimeOutMinutes setting.",
      );
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
        workers.push(this.#workerFactory({
          dataDir,
          costName: config.costName,
          direct: workerCount === 1,
          customCost: config.customCost,
        }));
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
        splitSynapseInsertNeuronCandidates:
          rawDiscover.splitSynapseInsertNeuronCandidates ?? undefined,
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
      console.info(
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
      const phase1Results = await this.#evaluateAll(
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
      assert(original, "Original creature was not evaluated");

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

            phase2Results = await this.#evaluateAll(
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

      // Cache successful candidates if success cache is enabled
      const successCacheDir = config.discoverySuccessCacheDir;
      if (successCacheDir) {
        const successfulCandidates = evaluationResults
          .filter((result) => result.kind === "candidate")
          .filter((result) => result.score > original.score)
          // Only cache single-step candidate types. Replay builds combinations on demand.
          .filter((result) =>
            !(result.candidate?.change.type?.startsWith("combo-"))
          )
          .filter((result) => result.candidate !== undefined);

        let cachedSuccessesCount = 0;
        for (const successful of successfulCandidates) {
          if (!successful.candidate) continue;
          recordSuccessSync(successCacheDir, successful.candidate, {
            originalScore: original.score,
            candidateScore: successful.score,
            scoreDelta: successful.score - original.score,
            originalError: original.error,
            error: successful.error,
          }, creature);
          cachedSuccessesCount++;
        }

        if (cachedSuccessesCount > 0 && verboseLogging) {
          verboseLog(
            `Cached ${cachedSuccessesCount} successful candidate${
              cachedSuccessesCount === 1 ? "" : "s"
            } to success cache.`,
          );
        }
      }

      // Cache failed candidates if failure cache is enabled
      if (failureCacheDir) {
        const failedCandidates = evaluationResults
          .filter((result) => result.kind === "candidate")
          .filter((result) => result.score <= original.score)
          .filter((result) => result.candidate !== undefined);

        let cachedFailuresCount = 0;
        for (const failed of failedCandidates) {
          if (failed.candidate) {
            recordFailureSync(failureCacheDir, failed.candidate, {
              originalScore: original.score,
              candidateScore: failed.score,
              scoreDelta: failed.score - original.score,
              error: failed.error,
              originalError: original.error,
            }, creature); // Pass base creature for actual changes extraction
            cachedFailuresCount++;
          }
        }

        if (cachedFailuresCount > 0 && verboseLogging) {
          verboseLog(
            `Cached ${cachedFailuresCount} failed candidate${
              cachedFailuresCount === 1 ? "" : "s"
            } to failure cache.`,
          );
        }
      }

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

      const evaluationArtifacts = this.#recordEvaluationSummaries({
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
        this.#logEvaluationSummary({
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

  #recordEvaluationSummaries(
    params: {
      discoveryID: string;
      evaluationResults: Array<{
        kind: "original" | "candidate";
        candidate?: DiscoveryCandidate;
        error: number;
        score: number;
      }>;
      originalScore: number;
      originalError: number;
      baseCreature: Creature;
    },
  ): { summaries: DiscoveryEvaluationSummary[]; archiveDir?: string } {
    const {
      discoveryID,
      evaluationResults,
      originalScore,
      originalError,
      baseCreature,
    } = params;
    const summaries: DiscoveryEvaluationSummary[] = [];
    const labelCounts = new Map<string, number>();

    let archiveDir: string | undefined;
    let resolvedArchiveDir: string | undefined;

    const ensureArchiveDir = (): string | undefined => {
      if (archiveDir) return archiveDir;

      const safeDiscoveryID = sanitizeSegment(discoveryID || "discovery");
      const timestamp = makeArchiveTimestamp();
      const targetDir = join(
        ".discovery",
        "candidates",
        safeDiscoveryID,
        timestamp,
      );
      try {
        Deno.mkdirSync(targetDir, { recursive: true });
        archiveDir = targetDir;
        resolvedArchiveDir = safeRealPath(targetDir);
      } catch (error) {
        console.warn(
          "[DiscoveryRunner] Failed to create discovery candidate archive:",
          error,
        );
        archiveDir = undefined;
      }
      return archiveDir;
    };

    const persistCreature = (
      baseLabel: string,
      payload: Record<string, unknown>,
    ): string | undefined => {
      const dir = ensureArchiveDir();
      if (!dir) {
        return undefined;
      }
      try {
        const safeLabel = sanitizeSegment(baseLabel);
        const index = (labelCounts.get(safeLabel) ?? 0) + 1;
        labelCounts.set(safeLabel, index);
        const suffix = index === 1 ? "" : `-${index}`;
        const filePath = join(dir, `${safeLabel}${suffix}.json`);
        Deno.writeTextFileSync(filePath, JSON.stringify(payload, null, 1));
        return safeRealPath(filePath);
      } catch (error) {
        console.warn(
          `[DiscoveryRunner] Failed to persist discovery candidate '${baseLabel}':`,
          error,
        );
        return undefined;
      }
    };

    const originalExport = baseCreature.exportJSON();

    for (const evaluation of evaluationResults) {
      const changeType = evaluation.candidate?.change.type;
      const scoreDelta = evaluation.score - originalScore;
      const improved = evaluation.kind === "candidate" && scoreDelta > 0;
      const errorDelta = originalError - evaluation.error;
      const errorDeltaPct = originalError === 0
        ? evaluation.error === 0 ? 0 : -100
        : (errorDelta / originalError) * 100;

      let archivePath: string | undefined;
      const exportPayload = evaluation.kind === "original"
        ? originalExport
        : evaluation.candidate?.creature.exportJSON();

      if (exportPayload) {
        const label = evaluation.kind === "original"
          ? "original"
          : `candidate-${changeType ?? "unknown"}`;
        archivePath = persistCreature(label, {
          kind: evaluation.kind,
          changeType,
          score: evaluation.score,
          error: evaluation.error,
          scoreDelta,
          improved,
          errorDelta,
          errorDeltaPct,
          creature: exportPayload,
        });
      }

      summaries.push({
        kind: evaluation.kind,
        changeType,
        description: evaluation.candidate?.change.description,
        score: evaluation.score,
        error: evaluation.error,
        scoreDelta,
        improved,
        archivePath,
        errorDelta,
        errorDeltaPct,
        neuronDetails: evaluation.candidate?.change.neuronDetails,
      });
    }

    if (archiveDir) {
      try {
        const summaryPath = join(archiveDir, "summary.json");
        Deno.writeTextFileSync(summaryPath, JSON.stringify(summaries, null, 1));
      } catch (error) {
        console.warn(
          "[DiscoveryRunner] Failed to persist discovery evaluation summary:",
          error,
        );
      }
    }

    return {
      summaries,
      archiveDir: resolvedArchiveDir ?? archiveDir,
    };
  }

  #logEvaluationSummary(
    params: { discoveryID: string; summaries: DiscoveryEvaluationSummary[] },
  ): void {
    const { discoveryID, summaries } = params;
    if (!summaries || summaries.length === 0) {
      return;
    }

    // Separate original from candidates
    const original = summaries.find((s) => s.kind === "original");
    const candidates = summaries.filter((s) => s.kind === "candidate");

    // Sort candidates by actual improvement (scoreDelta descending)
    candidates.sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0));

    // Identify the best candidate (highest score delta)
    const bestCandidate = candidates.length > 0 ? candidates[0] : undefined;

    console.info(
      `[DiscoveryRunner] ${
        bold(`Discovery ${discoveryID} evaluation summary:`)
      }`,
    );

    // Log original first
    if (original) {
      this.#logSingleSummary(original, false);
    }

    // Log candidates (sorted by expected improvement)
    for (const summary of candidates) {
      const isBest = summary === bestCandidate;
      this.#logSingleSummary(summary, isBest);
    }
  }

  #logSingleSummary(
    summary: DiscoveryEvaluationSummary,
    isBest: boolean,
  ): void {
    const label = summary.kind === "original"
      ? cyan("Original creature")
      : `Candidate (${summary.changeType ?? "unknown"})`;

    // Build description, including added neuron short ID if available
    let description = summary.description ? ` ${summary.description}` : "";
    if (summary.neuronDetails?.addedNeuronShortID) {
      description += ` [${summary.neuronDetails.addedNeuronShortID}]`;
    }

    // Format error delta with both absolute value and percentage
    let errorDeltaText: string;
    if (summary.kind === "original") {
      errorDeltaText = cyan("baseline");
    } else {
      const pctText = this.#formatErrorDelta(summary.errorDeltaPct ?? 0);
      // Show absolute error delta as well
      if (summary.errorDelta !== undefined && summary.errorDelta !== 0) {
        const sign = summary.errorDelta >= 0 ? "+" : "";
        errorDeltaText = `Δerr=${sign}${
          summary.errorDelta.toPrecision(3)
        } (${pctText})`;
      } else {
        errorDeltaText = pctText;
      }
    }

    const scoreText = `score=${summary.score.toPrecision(4)}`;
    const scoreDeltaText = summary.kind === "candidate" &&
        summary.scoreDelta !== undefined
      ? ` Δscore=${summary.scoreDelta >= 0 ? "+" : ""}${
        summary.scoreDelta.toPrecision(3)
      }`
      : "";
    const improvedText = summary.kind === "candidate"
      ? ` ${summary.improved ? green("✓improved") : yellow("no-improvement")}`
      : "";

    const bestMarker = isBest ? bold(cyan(" ★BEST")) : "";

    const mainInfo = summary.kind === "original"
      ? `error=${summary.error.toPrecision(6)} ${scoreText} ${errorDeltaText}`
      : `error=${
        summary.error.toPrecision(6)
      } ${scoreText}${scoreDeltaText}${improvedText} ${errorDeltaText}${bestMarker}`;

    console.info(
      `[DiscoveryRunner]   ${label}${description}: ${mainInfo}`,
    );

    // Log full neuron details for ALL candidates with neuron details
    // This helps identify patterns in why discoveries aren't improving
    if (summary.neuronDetails) {
      const nd = summary.neuronDetails;
      const prefix = isBest ? "★ " : "  ";
      console.info(
        `[DiscoveryRunner]     ${prefix}neuron: ` +
          `from=${shortID(nd.fromNeuronUUID)} to=${shortID(nd.toNeuronUUID)} ` +
          `squash=${nd.squash} ` +
          `inW=${nd.incomingWeight.toFixed(3)} outW=${
            nd.outgoingWeight.toFixed(3)
          } ` +
          `bias=${nd.bias.toFixed(3)}`,
      );
    }

    if (summary.archivePath) {
      console.info(
        `[DiscoveryRunner]     Saved creature at ${summary.archivePath}`,
      );
    }
  }

  #formatErrorDelta(value: number): string {
    return formatErrorDelta(value);
  }

  async #evaluateAll(
    workers: DiscoveryRunnerWorker[],
    tasks: Array<{
      kind: "original" | "candidate";
      creature: Creature;
      candidate?: DiscoveryCandidate;
    }>,
    feedbackLoop: boolean,
    costOfGrowth: number,
    verbose: boolean,
  ) {
    const queue = tasks.slice();
    const results: Array<{
      kind: "original" | "candidate";
      candidate?: DiscoveryCandidate;
      error: number;
      score: number;
    }> = [];

    const processNext = async (
      worker: DiscoveryRunnerWorker,
    ): Promise<void> => {
      const task = queue.shift();
      if (!task) return;

      const response = await worker.evaluate(task.creature, feedbackLoop);
      assert(
        response.evaluate,
        "Worker did not return evaluation data.",
      );
      const error = response.evaluate.error;
      const score = calculateScore(
        task.creature,
        error,
        costOfGrowth,
      );
      results.push({
        kind: task.kind,
        candidate: task.candidate,
        error,
        score,
      });

      if (verbose) {
        console.info("[DiscoveryRunner] Evaluation result", {
          kind: task.kind,
          change: task.candidate?.change.type,
          error,
          score,
        });
      }

      await processNext(worker);
    };

    await Promise.all(workers.map((worker) => processNext(worker)));

    return results;
  }

  /**
   * Filters discovery candidates for evaluation.
   *
   * Strategy:
   * 1. Group candidates by category (add-neurons, add-synapses, change-squash, remove-low-impact)
   * 2. Select at least one from each category (ensuring diversity)
   * 3. Fill remaining slots with best expected improvements across categories
   * 4. Count failure cache statistics during selection (single pass)
   *
   * NOTE: Rust is the single source of truth for candidate filtering based on
   * expected improvement and cost-of-growth. TypeScript does NOT re-filter
   * candidates based on these criteria (DRY principle).
   *
   * TypeScript filtering is limited to:
   * - Failure cache: Skip candidates that previously failed to improve
   * - Diversity selection: Ensure a mix of candidate types are evaluated
   * - Slot allocation: Limit total candidates based on available CPU threads
   *
   * Removal candidates (remove-low-impact, remove-neuron, remove-synapse) are treated
   * separately because they don't reduce error - they improve SCORE by reducing complexity.
   *
   * @param candidates - All discovery candidates (pre-filtered by Rust)
   * @param threadCount - Number of CPU threads available
   * @param config - NEAT configuration
   * @param failureCacheDir - Optional failure cache directory for statistics
   * @returns Filtered candidates ready for evaluation and list of skipped candidates
   */
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
    // Ensure candidate creatures have UUIDs before we do any failure-cache lookups.
    // This keeps cache keys stable and prevents subtle mis-matches.
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

    // Log failure cache statistics (cached candidates never consume slots).
    if (result.diagnostics?.cache && failureCacheDir) {
      const cache = result.diagnostics.cache;
      if (cache.totalCached > 0) {
        const parts: string[] = [];
        if (cache.cachedRemoval > 0) {
          parts.push(`${cache.cachedRemoval} removal`);
        }
        if (cache.cachedOther > 0) {
          const typeBreakdown = Array.from(cache.cachedOtherByType.entries())
            .map(([type, count]) => `${count} ${type}`)
            .join(", ");
          parts.push(typeBreakdown || `${cache.cachedOther} other`);
        }
        console.info(
          `[DiscoveryRunner] ⏭️ Skipped ${cache.totalCached} candidate${
            cache.totalCached === 1 ? "" : "s"
          } due to previous failure: ${parts.join(", ")}`,
        );
      }
    }

    // Log diversity selection summary for non-removal categories.
    if (result.diagnostics?.categoryDiversity) {
      const diversitySummary = Array.from(
        result.diagnostics.categoryDiversity.entries(),
      )
        .map(([type, counts]) => `${type}: ${counts.selected}/${counts.total}`)
        .join(", ");
      if (diversitySummary.length > 0) {
        console.info(
          `[DiscoveryRunner] Category diversity: ${diversitySummary}`,
        );
      }
    }

    // Log removal selection diagnostics (lowest-impact pool + chosen impacts).
    if (result.diagnostics?.removalSelection) {
      const removal = result.diagnostics.removalSelection;
      if (removal.poolImpacts.length > 0) {
        console.info(
          `[DiscoveryRunner] Top ${removal.poolImpacts.length} lowest-impact removal candidates pool: [${
            removal.poolImpacts.join(", ")
          }]`,
        );
      }
      if (removal.selectedImpacts.length > 0) {
        console.info(
          `[DiscoveryRunner] ✓ Selected ${removal.selectedImpacts.length} removal from top ${removal.poolImpacts.length}: [${
            removal.selectedImpacts.join(", ")
          }]`,
        );
      }
    }

    return { filtered: result.filtered, skipped: result.skipped };
  }
}

export interface FilterCandidatesForEvaluationDeps {
  /**
   * Optional discovery failure cache directory.
   * When provided, cached candidates are filtered out *before* slot allocation.
   */
  failureCacheDir?: string;
  /**
   * Dependency-injected cache checker (defaults to `isCandidateCachedSync`).
   * Inject a stub in tests for determinism and to avoid filesystem access.
   */
  isCandidateCached?: (dir: string, candidate: DiscoveryCandidate) => boolean;
  /**
   * Deterministic RNG injection point (defaults to `Math.random`).
   * Used for weighted sampling and removal shuffling.
   */
  random?: () => number;
}

export interface FilterCandidatesForEvaluationDiagnostics {
  cache?: {
    totalRemoval: number;
    cachedRemoval: number;
    totalOther: number;
    cachedOther: number;
    totalCached: number;
    cachedOtherByType: Map<string, number>;
  };
  categoryDiversity?: Map<string, { selected: number; total: number }>;
  removalSelection?: {
    poolImpacts: string[];
    selectedImpacts: string[];
  };
}

/**
 * Filters discovery candidates for evaluation.
 *
 * Goals:
 * - Filter out failure-cached candidates *before* slot allocation, across all types.
 * - Ensure category coverage (add-neurons, add-synapses, change-squash) based on config minimums.
 * - Fill remaining slots using weighted random sampling (expected score improvement), preserving exploration.
 * - Keep removal candidates in their own pool (added on top), using deterministic RNG injection for tests.
 *
 * Note: Rust remains the single source of truth for candidate generation and cost-of-growth gating.
 * TypeScript selection only handles caching, diversity, and evaluation slot allocation.
 */
export function filterCandidatesForEvaluation(
  candidates: DiscoveryCandidate[],
  threadCount: number,
  config: NeatConfig,
  deps: FilterCandidatesForEvaluationDeps = {},
): {
  filtered: DiscoveryCandidate[];
  skipped: Array<{ changeType?: DiscoveryChangeType; expected?: number }>;
  diagnostics?: FilterCandidatesForEvaluationDiagnostics;
} {
  const random = deps.random ?? Math.random;
  const failureCacheDir = deps.failureCacheDir;
  const isCandidateCached = deps.isCandidateCached ?? isCandidateCachedSync;

  const skipped: Array<
    { changeType?: DiscoveryChangeType; expected?: number }
  > = [];
  const diagnostics: FilterCandidatesForEvaluationDiagnostics = {};

  const cacheStats = {
    totalRemoval: 0,
    cachedRemoval: 0,
    totalOther: 0,
    cachedOther: 0,
    cachedOtherByType: new Map<string, number>(),
  };

  const isRemovalType = (type: DiscoveryChangeType): boolean =>
    type === "remove-low-impact" || type === "remove-neuron" ||
    type === "remove-synapse";

  // Filter cached candidates first so they never consume slots.
  const nonRemovalCandidates: DiscoveryCandidate[] = [];
  const removalCandidates: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const changeType = candidate.change.type;
    const cached = failureCacheDir
      ? isCandidateCached(failureCacheDir, candidate)
      : false;

    if (isRemovalType(changeType)) {
      cacheStats.totalRemoval++;
      if (cached) {
        cacheStats.cachedRemoval++;
        continue;
      }
      removalCandidates.push(candidate);
      continue;
    }

    cacheStats.totalOther++;
    if (cached) {
      cacheStats.cachedOther++;
      cacheStats.cachedOtherByType.set(
        changeType,
        (cacheStats.cachedOtherByType.get(changeType) ?? 0) + 1,
      );
      continue;
    }
    nonRemovalCandidates.push(candidate);
  }

  if (failureCacheDir) {
    const totalCached = cacheStats.cachedRemoval + cacheStats.cachedOther;
    diagnostics.cache = {
      ...cacheStats,
      totalCached,
    };
  }

  // Group non-removal candidates by change type.
  const byCategory = new Map<DiscoveryChangeType, DiscoveryCandidate[]>();
  for (const candidate of nonRemovalCandidates) {
    const type = candidate.change.type;
    const list = byCategory.get(type) ?? [];
    list.push(candidate);
    byCategory.set(type, list);
  }

  // Sort candidates within each category by expected score gain (descending).
  for (const [_type, list] of byCategory) {
    list.sort((a, b) => {
      const aExpected = a.change.expectedErrorReduction;
      const bExpected = b.change.expectedErrorReduction;
      const aScore = Number.isFinite(aExpected) ? (aExpected ?? 0) : 0;
      const bScore = Number.isFinite(bExpected) ? (bExpected ?? 0) : 0;
      if (aScore !== bScore) return bScore - aScore;
      // Keep insertion order stable for ties (important for deterministic behaviour in tests
      // and for preferring the "combined" candidate that is built before its per-item variants).
      return 0;
    });
  }

  // Calculate maxCandidates: scale with CPU, but never below category count so we can keep diversity.
  const maxCandidates = Math.max(2 * threadCount, byCategory.size);

  const minPerCategory = config.discoveryMinCandidatesPerCategory;
  const getCategoryMin = (type: DiscoveryChangeType): number => {
    switch (type) {
      case "add-neurons":
        return minPerCategory.addNeurons;
      case "add-synapses":
        return minPerCategory.addSynapses;
      case "change-squash":
        return minPerCategory.changeSquash;
      default:
        // For combo/other categories we do not force selection; they will be considered by weighting.
        return 0;
    }
  };

  // Phase 1: take minimum from each category.
  const selectedNonRemoval: DiscoveryCandidate[] = [];
  const usedFromCategory = new Map<DiscoveryChangeType, number>();
  for (const [type, list] of byCategory) {
    const minRequired = getCategoryMin(type);
    const toTake = Math.min(minRequired, list.length);
    for (let i = 0; i < toTake; i++) {
      selectedNonRemoval.push(list[i]);
    }
    usedFromCategory.set(type, toTake);
  }

  // Build remaining pool across categories.
  const remainingPool: DiscoveryCandidate[] = [];
  for (const [type, list] of byCategory) {
    const used = usedFromCategory.get(type) ?? 0;
    for (let i = used; i < list.length; i++) {
      remainingPool.push(list[i]);
    }
  }

  const remainingSlots = Math.max(0, maxCandidates - selectedNonRemoval.length);

  // Phase 2: fill remaining slots using weighted sampling (expected improvement).
  const weightOf = (candidate: DiscoveryCandidate): number => {
    const value = candidate.change.expectedErrorReduction;
    if (!Number.isFinite(value)) return 0;
    return value! > 0 ? value! : 0;
  };

  const hasPositiveWeights = remainingPool.some((c) => weightOf(c) > 0);
  const weightedPool = hasPositiveWeights
    ? [...remainingPool].sort((a, b) => weightOf(b) - weightOf(a))
    : remainingPool;

  const sampled = weightedSampleWithoutReplacement(
    weightedPool,
    remainingSlots,
    weightOf,
    random,
  );
  selectedNonRemoval.push(...sampled);

  // Track which remaining were not selected due to slot limits.
  const selectedSet = new Set(selectedNonRemoval);
  for (const candidate of remainingPool) {
    if (!selectedSet.has(candidate)) {
      skipped.push({
        changeType: candidate.change.type,
        expected: candidate.change.expectedErrorReduction,
      });
    }
  }

  // Category diversity diagnostics (non-removal only).
  const categoryDiversity = new Map<
    string,
    { selected: number; total: number }
  >();
  for (const [type, list] of byCategory) {
    const selectedCount = selectedNonRemoval.filter((c) =>
      c.change.type === type
    )
      .length;
    categoryDiversity.set(type, {
      selected: selectedCount,
      total: list.length,
    });
  }
  diagnostics.categoryDiversity = categoryDiversity;

  // Phase 3: select removal candidates from a lowest-impact pool, using injectable RNG.
  const removalSampleSize = Math.min(
    removalCandidates.length,
    minPerCategory.removeLowImpact,
  );

  let selectedRemovalCandidates: DiscoveryCandidate[] = [];
  if (removalSampleSize > 0) {
    if (removalCandidates.length <= removalSampleSize) {
      selectedRemovalCandidates = removalCandidates;
    } else {
      const candidatesWithImpact = removalCandidates.map((candidate) => {
        const impactMatch = candidate.change.description?.match(
          /impact:\s*([\d.e+-]+)/i,
        );
        const impact = impactMatch ? parseFloat(impactMatch[1]) : 1e-10;
        return { candidate, impact };
      });

      candidatesWithImpact.sort((a, b) => a.impact - b.impact);

      const TOP_N = Math.max(10, removalSampleSize * 3);
      const topCandidates = candidatesWithImpact.slice(0, TOP_N);

      const poolImpacts = topCandidates.map((c) => c.impact.toExponential(2));

      // Fisher-Yates shuffle on the pool and take the first N.
      for (let i = topCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [topCandidates[i], topCandidates[j]] = [
          topCandidates[j],
          topCandidates[i],
        ];
      }

      const selectedTop = topCandidates.slice(0, removalSampleSize);
      selectedRemovalCandidates = selectedTop.map((s) => s.candidate);

      diagnostics.removalSelection = {
        poolImpacts,
        selectedImpacts: selectedTop.map((s) => s.impact.toExponential(2)),
      };

      const selectedRemovalSet = new Set(selectedRemovalCandidates);
      for (const item of candidatesWithImpact) {
        if (!selectedRemovalSet.has(item.candidate)) {
          skipped.push({
            changeType: item.candidate.change.type,
            expected: item.candidate.change.expectedErrorReduction,
          });
        }
      }
    }
  }

  const filtered = [...selectedNonRemoval, ...selectedRemovalCandidates];
  return { filtered, skipped, diagnostics };
}

/**
 * Weighted roulette-wheel sampling without replacement.
 *
 * If all weights are non-finite or <= 0, falls back to uniform random selection.
 */
export function weightedSampleWithoutReplacement<T>(
  items: readonly T[],
  sampleSize: number,
  weightOf: (item: T) => number,
  random: () => number = Math.random,
): T[] {
  const selected: T[] = [];
  if (sampleSize <= 0 || items.length === 0) return selected;

  const pool: T[] = [...items];
  const takeCount = Math.min(sampleSize, pool.length);

  for (let pick = 0; pick < takeCount; pick++) {
    const weights = pool.map((item) => {
      const w = weightOf(item);
      return Number.isFinite(w) && w > 0 ? w : 0;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (totalWeight <= 0) {
      // Uniform fallback (stable with deterministic RNG).
      const index = Math.floor(random() * pool.length);
      selected.push(pool[index]);
      pool.splice(index, 1);
      continue;
    }

    const r = random() * totalWeight;
    let running = 0;
    let chosenIndex = -1;
    for (let i = 0; i < pool.length; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      running += w;
      if (r <= running) {
        chosenIndex = i;
        break;
      }
    }

    if (chosenIndex < 0) {
      // Numerical edge case: select the last positive-weight item.
      for (let i = pool.length - 1; i >= 0; i--) {
        if (weights[i] > 0) {
          chosenIndex = i;
          break;
        }
      }
    }

    if (chosenIndex < 0) {
      // Should never happen, but keep behaviour safe.
      chosenIndex = pool.length - 1;
    }

    selected.push(pool[chosenIndex]);
    pool.splice(chosenIndex, 1);
  }

  return selected;
}

function sanitizeSegment(value: string): string {
  const lowered = value.toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9._-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return cleaned.length > 0 ? cleaned : "entry";
}

function makeArchiveTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeRealPath(path: string): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return path;
  }
}

const MIN_PERCENT_FRACTION_DIGITS = 3;
const SIGNIFICANT_PERCENT_DIGITS = 3;
const MAX_PERCENT_FRACTION_DIGITS = 100;
const ZERO_PERCENT = `+0.${"0".repeat(MIN_PERCENT_FRACTION_DIGITS)}%`;

/**
 * Formats a percentage value with appropriate significant digits.
 * Used for displaying error deltas and expected improvements in discovery evaluation summaries.
 *
 * @param value - The percentage value to format (e.g., 0.5 for 0.5%)
 * @returns Formatted string like "+0.500%" or "-1.23%"
 */
export function formatPercentWithSignificantDigits(value: number): string {
  if (value === 0) {
    return ZERO_PERCENT;
  }
  const sign = value >= 0 ? "+" : "-";
  const absValue = Math.abs(value);
  const exponent = Math.floor(Math.log10(absValue));
  let fractionDigits: number;
  if (Number.isFinite(exponent) && exponent >= 0) {
    const digitsBeforeDecimal = exponent + 1;
    fractionDigits = Math.max(
      MIN_PERCENT_FRACTION_DIGITS,
      SIGNIFICANT_PERCENT_DIGITS - digitsBeforeDecimal,
    );
  } else {
    const leadingZeros = Number.isFinite(exponent)
      ? Math.abs(exponent) - 1
      : SIGNIFICANT_PERCENT_DIGITS;
    fractionDigits = Math.max(
      MIN_PERCENT_FRACTION_DIGITS,
      leadingZeros + SIGNIFICANT_PERCENT_DIGITS,
    );
  }
  fractionDigits = Math.min(fractionDigits, MAX_PERCENT_FRACTION_DIGITS);
  const magnitude = absValue.toFixed(fractionDigits);
  return `${sign}${magnitude}%`;
}

/**
 * Formats an error delta percentage with colour coding.
 * Green for improvements > 0.05%, red for declines < -0.05%, yellow otherwise.
 *
 * @param value - The error delta percentage (e.g., 0.5 for 0.5% improvement)
 * @returns Formatted and colour-coded string
 */
export function formatErrorDelta(value: number): string {
  if (!Number.isFinite(value)) {
    return yellow("±0.000%");
  }
  const formatted = formatPercentWithSignificantDigits(value);
  if (value > 0.05) return green(formatted);
  if (value < -0.05) return red(formatted);
  return yellow(formatted);
}
