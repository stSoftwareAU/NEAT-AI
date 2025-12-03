import { assert, assertExists } from "@std/assert";
import { bold, cyan, green, red, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { join } from "@std/path/join";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { isRustDiscoveryEnabled } from "../architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import type { Creature } from "../Creature.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import {
  buildCombinedFromSuccessful,
  buildDiscoveryCandidates,
  type DiscoveredNeuronDetails,
  type DiscoveryChangeType,
  shortID,
} from "./DiscoveryCandidates.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";

import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import {
  filterCachedCandidates,
  isCandidateCachedSync,
  recordFailureSync,
} from "./FailureCache.ts";

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
  costName: string;
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
const EXPECTATION_ALERT_THRESHOLD = 25; // percentage-point gap before warning

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
  expectedErrorReductionPct?: number;
  errorDelta?: number;
  errorDeltaPct?: number;
  expectationMismatch?: {
    expectedPct: number;
    actualPct: number;
    gapPct: number;
  };
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
    options?: { skipCombinedCandidates?: boolean },
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
        { skipCombinedCandidates: true },
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
        const minThreshold = config.costOfGrowth *
          config.discoveryMinImprovementVsCostOfGrowthMultiplier;
        verboseLog(
          `Skipped ${skipped.length} candidate${
            skipped.length === 1 ? "" : "s"
          } with expected improvement below ${
            minThreshold.toPrecision(3)
          } (${config.discoveryMinImprovementVsCostOfGrowthMultiplier}× costOfGrowth): ${
            skipped.map((entry) =>
              `${entry.changeType ?? "unknown"} (expected ${
                entry.expected?.toPrecision(3) ?? "n/a"
              })`
            ).join(", ")
          }.`,
        );
      }

      // Filter out cached failures if failure cache is enabled
      const { filtered: uncachedCandidates, cachedCount } =
        filterCachedCandidates(failureCacheDir, filteredSingleCandidates);
      if (cachedCount > 0) {
        verboseLog(
          `Skipped ${cachedCount} candidate${
            cachedCount === 1 ? "" : "s"
          } from failure cache (previously failed to improve).`,
        );
      }

      markPhase("Candidate synthesis (Phase 1)", candidateBuildStart);

      // Phase 1 evaluation: Score single candidates + original
      const phase1Tasks: Array<{
        kind: "original" | "candidate";
        creature: Creature;
        candidate?: DiscoveryCandidate;
      }> = [
        { kind: "original", creature },
        ...uncachedCandidates.map((candidate) => ({
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

        // Extract successful candidates for combination
        const successfulCandidates = successfulSingles
          .map((result) => result.candidate)
          .filter((c): c is DiscoveryCandidate => c !== undefined);

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

          // Filter out cached failures for combined candidates too
          const { filtered: filteredCombos, cachedCount: comboCachedCount } =
            filterCachedCandidates(failureCacheDir, thresholdFilteredCombos);
          if (comboCachedCount > 0) {
            verboseLog(
              `[Phase 2] Skipped ${comboCachedCount} combined candidate${
                comboCachedCount === 1 ? "" : "s"
              } from failure cache.`,
            );
          }

          if (filteredCombos.length > 0) {
            const phase2Tasks = filteredCombos.map((candidate) => ({
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
            });
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
        // Include creature short ID (last 8 characters of UUID) in message for traceability
        const creatureUUID = improved.candidate.creature.uuid;
        const creatureShortID = creatureUUID && creatureUUID.length > 8
          ? creatureUUID.slice(-8)
          : creatureUUID ?? "unknown";
        // Ensure message includes changeType for test compatibility
        const message =
          `${description} (${changeType}) for ${discoverResult.ID}: Score +${
            scoreDelta.toPrecision(6)
          } -> ${improved.score.toPrecision(6)} (${creatureShortID})`;

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

      const expectedErrorReductionPct = evaluation.candidate?.change
          .expectedErrorReduction !== undefined
        ? evaluation.candidate.change.expectedErrorReduction * 100
        : undefined;

      const expectationMismatch = this.#computeExpectationMismatch(
        expectedErrorReductionPct,
        evaluation.kind === "candidate" ? errorDeltaPct : undefined,
      );

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
          expectedErrorReductionPct,
          expectationMismatch,
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
        expectedErrorReductionPct,
        errorDelta,
        errorDeltaPct,
        expectationMismatch,
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

    // Sort candidates by expected improvement (descending), undefined values last
    candidates.sort((a, b) => {
      const aExp = a.expectedErrorReductionPct;
      const bExp = b.expectedErrorReductionPct;
      if (aExp === undefined && bExp === undefined) return 0;
      if (aExp === undefined) return 1;
      if (bExp === undefined) return -1;
      return bExp - aExp;
    });

    // Identify the best candidate (first in sorted list)
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

    const expectedText = summary.expectedErrorReductionPct !== undefined
      ? ` expected ${this.#formatExpected(summary.expectedErrorReductionPct)}`
      : "";

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

    const mismatchText = summary.expectationMismatch
      ? ` ${
        red(
          `⚠ mismatch expected ${
            this.#formatExpected(summary.expectationMismatch.expectedPct)
          } vs actual ${
            this.#formatErrorDelta(summary.expectationMismatch.actualPct)
          }`,
        )
      }`
      : "";

    const bestMarker = isBest ? bold(cyan(" ★BEST")) : "";

    const mainInfo = summary.kind === "original"
      ? `error=${summary.error.toPrecision(6)} ${scoreText} ${errorDeltaText}`
      : `error=${
        summary.error.toPrecision(6)
      } ${scoreText}${scoreDeltaText}${improvedText} ${errorDeltaText}${expectedText}${bestMarker}`;

    console.info(
      `[DiscoveryRunner]   ${label}${description}: ${mainInfo}${mismatchText}`,
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

  #computeExpectationMismatch(
    expected?: number,
    actual?: number,
  ): { expectedPct: number; actualPct: number; gapPct: number } | undefined {
    if (
      expected === undefined || !Number.isFinite(expected) ||
      actual === undefined || !Number.isFinite(actual)
    ) {
      return undefined;
    }
    const gap = expected - actual;
    if (Math.abs(gap) < EXPECTATION_ALERT_THRESHOLD) {
      return undefined;
    }
    return {
      expectedPct: expected,
      actualPct: actual,
      gapPct: gap,
    };
  }

  #formatErrorDelta(value: number): string {
    return formatErrorDelta(value);
  }

  #formatExpected(value: number): string {
    return formatExpected(value);
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
   * Removal candidates are treated separately because they don't reduce error -
   * they improve SCORE by reducing complexity.
   *
   * @param candidates - All discovery candidates
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
    const maxCandidates = 2 * threadCount;

    // Calculate the minimum expected improvement threshold
    const multiplier = config.discoveryMinImprovementVsCostOfGrowthMultiplier;
    const minExpectedImprovement = config.costOfGrowth * multiplier;

    // Group candidates by category for diversity selection
    const byCategory = new Map<string, DiscoveryCandidate[]>();
    const removalCandidates: DiscoveryCandidate[] = [];
    const skipped: Array<{
      changeType?: DiscoveryChangeType;
      expected?: number;
    }> = [];

    // Track failure cache statistics (single pass)
    const cacheStats = {
      totalRemoval: 0,
      cachedRemoval: 0,
      totalOther: 0,
      cachedOther: 0,
    };

    for (const candidate of candidates) {
      CreatureUtil.makeUUID(candidate.creature);
      const expected = candidate.change.expectedErrorReduction;
      const changeType = candidate.change.type;
      const isRemovalCandidate = changeType === "remove-low-impact";

      // Check failure cache (single pass for all candidates)
      const isCached = failureCacheDir
        ? isCandidateCachedSync(failureCacheDir, candidate)
        : false;

      // Removal candidates are handled separately - they improve score, not error
      if (isRemovalCandidate) {
        cacheStats.totalRemoval++;
        if (isCached) cacheStats.cachedRemoval++;
        removalCandidates.push(candidate);
        continue;
      }

      cacheStats.totalOther++;
      if (isCached) cacheStats.cachedOther++;

      // Check threshold for non-removal candidates
      let meetsThreshold = true;
      if (expected !== undefined) {
        if (!Number.isFinite(expected)) {
          meetsThreshold = false;
        } else {
          meetsThreshold = multiplier === 0
            ? expected > 0
            : expected >= minExpectedImprovement;
        }
      }

      if (!meetsThreshold) {
        skipped.push({ changeType, expected });
        continue;
      }

      // Group by category for diversity selection
      if (!byCategory.has(changeType)) {
        byCategory.set(changeType, []);
      }
      byCategory.get(changeType)!.push(candidate);
    }

    // Log failure cache statistics (single pass complete)
    if (failureCacheDir) {
      if (cacheStats.cachedRemoval > 0 || cacheStats.cachedOther > 0) {
        const parts: string[] = [];
        if (cacheStats.totalRemoval > 0) {
          parts.push(
            `removal: ${cacheStats.cachedRemoval}/${cacheStats.totalRemoval} cached`,
          );
        }
        if (cacheStats.totalOther > 0) {
          parts.push(
            `other: ${cacheStats.cachedOther}/${cacheStats.totalOther} cached`,
          );
        }
        console.info(
          `[DiscoveryRunner] Failure cache stats: ${parts.join(", ")}`,
        );
      }
    }

    // Sort each category by expected improvement (descending)
    for (const [_type, categoryCandidates] of byCategory) {
      categoryCandidates.sort((a, b) => {
        const aExpected = a.change.expectedErrorReduction;
        const bExpected = b.change.expectedErrorReduction;
        if (aExpected !== undefined && bExpected !== undefined) {
          return bExpected - aExpected;
        }
        if (aExpected !== undefined) return -1;
        if (bExpected !== undefined) return 1;
        return 0;
      });
    }

    // PHASE 1: Select at least one from each category (ensuring diversity)
    const selected: DiscoveryCandidate[] = [];
    const usedFromCategory = new Map<string, number>();

    // Take the best from each non-removal category first
    for (const [type, categoryCandidates] of byCategory) {
      if (categoryCandidates.length > 0) {
        selected.push(categoryCandidates[0]);
        usedFromCategory.set(type, 1);
      }
    }

    // PHASE 2: Fill remaining slots with best overall candidates
    const remainingSlots = maxCandidates - selected.length;
    if (remainingSlots > 0) {
      // Collect all remaining candidates (not yet selected) with their expected values
      const remaining: Array<{
        candidate: DiscoveryCandidate;
        expected: number | undefined;
      }> = [];

      for (const [type, categoryCandidates] of byCategory) {
        const usedCount = usedFromCategory.get(type) ?? 0;
        for (let i = usedCount; i < categoryCandidates.length; i++) {
          remaining.push({
            candidate: categoryCandidates[i],
            expected: categoryCandidates[i].change.expectedErrorReduction,
          });
        }
      }

      // Sort by expected improvement (descending)
      remaining.sort((a, b) => {
        if (a.expected !== undefined && b.expected !== undefined) {
          return b.expected - a.expected;
        }
        if (a.expected !== undefined) return -1;
        if (b.expected !== undefined) return 1;
        return 0;
      });

      // Take the best remaining candidates
      const additionalCount = Math.min(remainingSlots, remaining.length);
      for (let i = 0; i < additionalCount; i++) {
        selected.push(remaining[i].candidate);
      }

      // Mark the rest as skipped
      for (let i = additionalCount; i < remaining.length; i++) {
        skipped.push({
          changeType: remaining[i].candidate.change.type,
          expected: remaining[i].expected,
        });
      }
    }

    // Log diversity selection summary
    const diversitySummary = Array.from(byCategory.keys())
      .map((type) => {
        const total = byCategory.get(type)!.length;
        const selectedCount = selected.filter((c) => c.change.type === type)
          .length;
        return `${type}: ${selectedCount}/${total}`;
      })
      .join(", ");
    if (byCategory.size > 0) {
      console.info(
        `[DiscoveryRunner] Category diversity: ${diversitySummary}`,
      );
    }

    // PHASE 3: Select removal candidates (separately, added on top)
    const removalSampleSize = Math.min(removalCandidates.length, 3);
    let selectedRemovalCandidates: DiscoveryCandidate[];

    if (removalCandidates.length <= removalSampleSize) {
      selectedRemovalCandidates = removalCandidates;
    } else {
      // Extract impact values from candidate descriptions (format: "impact: X.XXe-XX")
      const candidatesWithImpact = removalCandidates.map((candidate) => {
        const impactMatch = candidate.change.description?.match(
          /impact:\s*([\d.e+-]+)/i,
        );
        const impact = impactMatch ? parseFloat(impactMatch[1]) : 1e-10;
        return { candidate, impact };
      });

      // Sort by impact ascending (lowest = safest to remove)
      candidatesWithImpact.sort((a, b) => a.impact - b.impact);

      // Take the top 10 lowest-impact candidates as the pool to select from
      const TOP_N = 10;
      const topCandidates = candidatesWithImpact.slice(0, TOP_N);

      // Log the top 10 pool before selection
      const topPoolDetails = topCandidates
        .map((c) => `${c.impact.toExponential(2)}`)
        .join(", ");
      console.info(
        `[DiscoveryRunner] Top ${topCandidates.length} lowest-impact removal candidates pool: [${topPoolDetails}]`,
      );

      // Fisher-Yates shuffle on the top candidates and take first N
      for (let i = topCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [topCandidates[i], topCandidates[j]] = [
          topCandidates[j],
          topCandidates[i],
        ];
      }
      const selectedTop = topCandidates.slice(0, removalSampleSize);
      selectedRemovalCandidates = selectedTop.map((s) => s.candidate);

      // Log which ones were chosen with their impact values
      const selectedDetails = selectedTop
        .map((s) => `${s.impact.toExponential(2)}`)
        .join(", ");
      console.info(
        `[DiscoveryRunner] ✓ Selected ${removalSampleSize} removal from top ${topCandidates.length}: [${selectedDetails}]`,
      );

      // Mark remaining candidates as skipped
      const selectedSet = new Set(selectedRemovalCandidates);
      for (const item of candidatesWithImpact) {
        if (!selectedSet.has(item.candidate)) {
          skipped.push({
            changeType: item.candidate.change.type,
            expected: item.candidate.change.expectedErrorReduction,
          });
        }
      }
    }

    // Combine: other candidates first, then removal candidates (added on top)
    const filtered = [...selected, ...selectedRemovalCandidates];

    return { filtered, skipped };
  }
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

/**
 * Formats an expected improvement percentage.
 *
 * @param value - The expected improvement percentage (e.g., 0.5 for 0.5%)
 * @returns Formatted string in cyan colour
 */
export function formatExpected(value: number): string {
  if (!Number.isFinite(value)) {
    return cyan("n/a");
  }
  return cyan(formatPercentWithSignificantDigits(value));
}
