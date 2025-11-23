import { assert } from "@std/assert";
import { bold, cyan, green, red, yellow } from "@std/fmt/colors";
import { join } from "@std/path/join";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { isRustDiscoveryEnabled } from "../architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import type { Creature } from "../Creature.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import { createNeatConfig } from "../config/NeatConfig.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryChangeType,
} from "./DiscoveryCandidates.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";

import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";

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
}

export class DiscoveryRunner {
  #workerFactory: DiscoveryRunnerWorkerFactory;
  #candidateBuilder: (
    creature: Creature,
    discovery: DiscoverResult,
  ) => DiscoveryCandidate[];
  #rustDiscoveryEnabled: () => boolean;

  constructor(deps: DiscoveryRunnerDeps = {}) {
    this.#workerFactory = deps.workerFactory ?? DEFAULT_WORKER_FACTORY;
    this.#candidateBuilder = deps.candidateBuilder ?? buildDiscoveryCandidates;
    this.#rustDiscoveryEnabled = deps.rustDiscoveryEnabled ??
      DEFAULT_RUST_CHECK;
  }

  async discoverDir(input: DiscoveryDirInput): Promise<DiscoveryDirResult> {
    if (!this.#rustDiscoveryEnabled()) {
      throw new Error(
        "Discovery requires the NEAT-AI-Discovery Rust library to be available.",
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
    if (config.discoveryTimeOutMinutes <= 0) {
      throw new Error(
        "Discovery requires a positive discoveryTimeOutMinutes setting.",
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
    const workerCount = Math.max(1, config.threads);
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

      const workerOptions: NeatOptions = (config.log && config.log > 0) ||
          !config.verbose
        ? config
        : { ...config, log: 1 };

      verboseLog(
        `Starting discovery for creature ${creature.uuid ?? "unknown"} using ${
          workerCount === 1 ? "single" : workerCount
        } worker${workerCount === 1 ? "" : "s"}.`,
      );

      const discoveryStart = performance.now();
      const discoveryResponse = await workers[0].discover(
        creature,
        workerOptions,
      );
      assert(
        discoveryResponse.discover,
        "Worker did not return discovery results.",
      );
      const rawDiscover = discoveryResponse.discover;
      const discoverResult: DiscoverResult = {
        ID: rawDiscover.ID,
        addHelpfulSynapses: rawDiscover.addHelpfulSynapses ?? undefined,
        addHelpfulNeurons: rawDiscover.addHelpfulNeurons ?? undefined,
        removeHarmfulSynapse: rawDiscover.removeHarmfulSynapse ?? undefined,
        removeHarmfulNeurons: rawDiscover.removeHarmfulNeurons ?? undefined,
        candidateSquashes: rawDiscover.candidateSquashes ?? undefined,
      };

      const addCount = discoverResult.addHelpfulSynapses?.length ?? 0;
      const neuronCount = discoverResult.addHelpfulNeurons?.length ?? 0;
      const removePresent = discoverResult.removeHarmfulSynapse ? 1 : 0;
      const squashCount = discoverResult.candidateSquashes?.length ?? 0;
      verboseLog(
        `Discovery ${discoverResult.ID} suggested ${addCount} add, ${neuronCount} neuron, ${removePresent} remove, ${squashCount} squash candidate(s).`,
      );
      markPhase("Discovery phase", discoveryStart);

      const candidateBuildStart = performance.now();
      const candidates = this.#candidateBuilder(creature, discoverResult);
      verboseLog(
        `Built ${candidates.length} candidate creature${
          candidates.length === 1 ? "" : "s"
        }: ${candidates.map((c) => c.change.type).join(", ") || "none"}.`,
      );

      const { filtered: filteredCandidates, skipped } = this
        .#filterCandidatesByGrowthCost(
          creature,
          candidates,
          config.costOfGrowth,
        );
      if (skipped.length > 0) {
        verboseLog(
          `Skipped ${skipped.length} candidate${
            skipped.length === 1 ? "" : "s"
          } below cost-of-growth threshold: ${
            skipped.map((entry) =>
              `${entry.changeType ?? "unknown"} (expected ${
                entry.expected?.toPrecision(3) ?? "n/a"
              } vs ${entry.threshold.toPrecision(3)})`
            ).join(", ")
          }.`,
        );
      }
      markPhase("Candidate synthesis", candidateBuildStart);

      const evaluationTasks: Array<{
        kind: "original" | "candidate";
        creature: Creature;
        candidate?: DiscoveryCandidate;
      }> = [
        { kind: "original", creature },
        ...filteredCandidates.map((candidate) => ({
          kind: "candidate" as const,
          creature: candidate.creature,
          candidate,
        })),
      ];

      const evaluationStart = performance.now();
      const evaluationResults = await this.#evaluateAll(
        workers,
        evaluationTasks,
        config.feedbackLoop,
        config.costOfGrowth,
        verboseLogging,
      );
      markPhase("Candidate evaluation", evaluationStart);

      const original = evaluationResults.find((result) =>
        result.kind === "original"
      );
      assert(original, "Original creature was not evaluated");

      const improved = evaluationResults
        .filter((result) => result.kind === "candidate")
        .filter((result) => result.score > original.score)
        .sort((a, b) => b.score - a.score)[0];

      const outcome: DiscoveryDirResult = {
        discovery: discoverResult,
        original: {
          error: original.error,
          score: original.score,
        },
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
      if (verboseLogging) {
        this.#logEvaluationSummary({
          discoveryID: discoverResult.ID,
          summaries: evaluationArtifacts.summaries,
        });
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

      const safeDiscoveryID = sanitiseSegment(discoveryID || "discovery");
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
        const safeLabel = sanitiseSegment(baseLabel);
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
    console.info(
      `[DiscoveryRunner] ${
        bold(`Discovery ${discoveryID} evaluation summary:`)
      }`,
    );
    for (const summary of summaries) {
      const label = summary.kind === "original"
        ? cyan("Original creature")
        : `Candidate (${summary.changeType ?? "unknown"})`;
      const description = summary.description ? ` ${summary.description}` : "";
      const errorDeltaText = summary.kind === "original"
        ? cyan("baseline")
        : this.#formatErrorDelta(summary.errorDeltaPct ?? 0);
      const expectedText = summary.expectedErrorReductionPct !== undefined
        ? ` expected ${this.#formatExpected(summary.expectedErrorReductionPct)}`
        : "";
      const scoreText = `, score=${summary.score.toPrecision(4)}`;
      const scoreDeltaText = summary.kind === "candidate" &&
          summary.scoreDelta !== undefined
        ? `, delta=${summary.scoreDelta >= 0 ? "+" : ""}${
          summary.scoreDelta.toPrecision(4)
        }`
        : "";
      const improvedText = summary.kind === "candidate"
        ? `, improved=${summary.improved ? "yes" : "no"}`
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
      const mainInfo = summary.kind === "original"
        ? `error=${summary.error.toPrecision(6)}${scoreText} ${errorDeltaText}`
        : `error=${
          summary.error.toPrecision(6)
        }${scoreText}${scoreDeltaText}${improvedText} ${errorDeltaText}${expectedText}`;
      console.info(
        `[DiscoveryRunner]   ${label}${description}: ${mainInfo}${mismatchText}`,
      );
      if (summary.archivePath) {
        console.info(
          `[DiscoveryRunner]     Saved creature at ${summary.archivePath}`,
        );
      }
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
    if (!Number.isFinite(value)) {
      return yellow("±0.000%");
    }
    const formatted = formatPercentWithSignificantDigits(value);
    if (value > 0.05) return green(formatted);
    if (value < -0.05) return red(formatted);
    return yellow(formatted);
  }

  #formatExpected(value: number): string {
    if (!Number.isFinite(value)) {
      return cyan("n/a");
    }
    return cyan(formatPercentWithSignificantDigits(value));
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

  #filterCandidatesByGrowthCost(
    baseCreature: Creature,
    candidates: DiscoveryCandidate[],
    costOfGrowth: number,
  ): {
    filtered: DiscoveryCandidate[];
    skipped: Array<{
      changeType?: DiscoveryChangeType;
      expected?: number;
      threshold: number;
    }>;
  } {
    if (!Number.isFinite(costOfGrowth) || costOfGrowth <= 0) {
      return { filtered: candidates, skipped: [] };
    }
    const baseExport = baseCreature.exportJSON();
    const baseHiddenUUIDs = new Set(
      baseExport.neurons
        .filter((neuron) => neuron.type === "hidden")
        .map((neuron) => neuron.uuid),
    );
    const baseSynapseKeys = new Set(
      baseExport.synapses.map((synapse) =>
        `${synapse.fromUUID}->${synapse.toUUID}`
      ),
    );

    const filtered: DiscoveryCandidate[] = [];
    const skipped: Array<{
      changeType?: DiscoveryChangeType;
      expected?: number;
      threshold: number;
    }> = [];

    for (const candidate of candidates) {
      CreatureUtil.makeUUID(candidate.creature);
      const candidateExport = candidate.creature.exportJSON();
      const additions = countStructuralAdditions(
        candidateExport,
        baseHiddenUUIDs,
        baseSynapseKeys,
      );
      const addedUnits = additions.addedHidden + additions.addedSynapses;
      if (addedUnits <= 0) {
        filtered.push(candidate);
        continue;
      }
      const expected = candidate.change.expectedErrorReduction;
      if (
        expected === undefined || !Number.isFinite(expected) ||
        expected <= 0
      ) {
        filtered.push(candidate);
        continue;
      }
      const threshold = addedUnits * costOfGrowth;
      if (expected < threshold) {
        skipped.push({
          changeType: candidate.change.type,
          expected,
          threshold,
        });
        continue;
      }
      filtered.push(candidate);
    }

    return { filtered, skipped };
  }
}

function sanitiseSegment(value: string): string {
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

function countStructuralAdditions(
  candidate: CreatureExport,
  baseHiddenUUIDs: Set<string>,
  baseSynapseKeys: Set<string>,
): { addedHidden: number; addedSynapses: number } {
  let addedHidden = 0;
  for (const neuron of candidate.neurons) {
    if (neuron.type !== "hidden") continue;
    if (!baseHiddenUUIDs.has(neuron.uuid)) {
      addedHidden++;
    }
  }

  let addedSynapses = 0;
  for (const synapse of candidate.synapses) {
    const key = `${synapse.fromUUID}->${synapse.toUUID}`;
    if (!baseSynapseKeys.has(key)) {
      addedSynapses++;
    }
  }

  return { addedHidden, addedSynapses };
}

const MIN_PERCENT_FRACTION_DIGITS = 3;
const SIGNIFICANT_PERCENT_DIGITS = 3;
const MAX_PERCENT_FRACTION_DIGITS = 100;
const ZERO_PERCENT = `+0.${"0".repeat(MIN_PERCENT_FRACTION_DIGITS)}%`;

function formatPercentWithSignificantDigits(value: number): string {
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
