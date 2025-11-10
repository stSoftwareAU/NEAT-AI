import { assert } from "@std/assert";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { isRustDiscoveryEnabled } from "../architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import type { Creature } from "../Creature.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import { createNeatConfig } from "../config/NeatConfig.ts";
import { buildDiscoveryCandidates } from "./DiscoveryCandidates.ts";
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

    const workerCount = Math.max(1, config.threads);
    const workers: DiscoveryRunnerWorker[] = [];
    try {
      for (let i = 0; i < workerCount; i++) {
        workers.push(this.#workerFactory({
          dataDir,
          costName: config.costName,
          direct: workerCount === 1,
          customCost: config.customCost,
        }));
      }

      const discoveryResponse = await workers[0].discover(
        creature,
        config,
      );
      assert(
        discoveryResponse.discover,
        "Worker did not return discovery results.",
      );
      const rawDiscover = discoveryResponse.discover;
      const discoverResult: DiscoverResult = {
        ID: rawDiscover.ID,
        addHelpfulSynapses: rawDiscover.addHelpfulSynapses ?? undefined,
        removeHarmfulSynapse: rawDiscover.removeHarmfulSynapse ?? undefined,
        candidateSquashes: rawDiscover.candidateSquashes ?? undefined,
      };

      const candidates = this.#candidateBuilder(creature, discoverResult);

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

      const evaluationResults = await this.#evaluateAll(
        workers,
        evaluationTasks,
        config.feedbackLoop,
        config.costOfGrowth,
      );

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
          `${improved.candidate.change.type} for discovery ${discoverResult.ID} improved score by ${
            scoreDelta >= 0 ? "+" : ""
          }${scoreDelta.toFixed(4)} (from ${original.score.toFixed(4)} to ${
            improved.score.toFixed(4)
          }).${changeDescription ? changeDescription : ""}`;

        outcome.improvement = {
          changeType: improved.candidate.change.type,
          error: improved.error,
          score: improved.score,
          scoreDelta,
          message,
          creature: improved.candidate.creature.exportJSON(),
        };
      }

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

  async #evaluateAll(
    workers: DiscoveryRunnerWorker[],
    tasks: Array<{
      kind: "original" | "candidate";
      creature: Creature;
      candidate?: DiscoveryCandidate;
    }>,
    feedbackLoop: boolean,
    costOfGrowth: number,
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

      await processNext(worker);
    };

    await Promise.all(workers.map((worker) => processNext(worker)));

    return results;
  }
}
