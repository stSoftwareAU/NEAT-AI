import { assert } from "@std/assert";
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

export interface DiscoveryDirInput {
  creature: Creature;
  dataDir: string;
  options: NeatOptions;
}

export interface DiscoveryEvaluationSummary {
  kind: "original" | "candidate";
  changeType?: DiscoveryChangeType;
  score: number;
  error: number;
  scoreDelta?: number;
  improved: boolean;
  archivePath?: string;
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
      markPhase("Candidate synthesis", candidateBuildStart);

      const evaluationTasks: Array<{
        kind: "original" | "candidate";
        creature: Creature;
        candidate?: DiscoveryCandidate;
      }> = [
        { kind: "original", creature },
        ...candidates.map((candidate) => ({
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
        const changeDescription = improved.candidate.change.description
          ? ` ${improved.candidate.change.description}`
          : "";
        const message =
          `🕵🏻‍♂️ ${improved.candidate.change.type} for ${discoverResult.ID}: Score +${
            scoreDelta.toPrecision(2)
          } -> ${improved.score.toPrecision(4)}.${
            changeDescription ? changeDescription : ""
          }`;

        outcome.improvement = {
          changeType: improved.candidate.change.type,
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
        baseCreature: creature,
      });
      if (evaluationArtifacts.summaries.length > 0) {
        outcome.evaluations = evaluationArtifacts.summaries;
      }
      if (evaluationArtifacts.archiveDir) {
        outcome.candidateArchiveDir = evaluationArtifacts.archiveDir;
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
      baseCreature: Creature;
    },
  ): { summaries: DiscoveryEvaluationSummary[]; archiveDir?: string } {
    const { discoveryID, evaluationResults, originalScore, baseCreature } =
      params;
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
          creature: exportPayload,
        });
      }

      summaries.push({
        kind: evaluation.kind,
        changeType,
        score: evaluation.score,
        error: evaluation.error,
        scoreDelta,
        improved,
        archivePath,
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
