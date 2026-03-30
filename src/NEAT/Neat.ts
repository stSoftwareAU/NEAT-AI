/**
 * Neat.ts - Central class for the NEAT algorithm.
 *
 * Issue #1599: Refactored from 1,312 lines into a ~420-line facade.
 * Responsibilities are delegated to focused modules in src/neat/:
 * - NeatEvolution.ts   - Core evolution loop
 * - NeatScheduling.ts  - Discovery and training task scheduling
 */

import { ensureDirSync } from "@std/fs";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import { DeDuplicator } from "../architecture/DeDuplicator.ts";
import { Fitness } from "../architecture/Fitness.ts";
import { AdaptiveFineTuneTracker } from "../blackbox/AdaptiveFineTuneTracker.ts";
import { Breed } from "../breed/Breed.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import type {
  ResponseData,
  WorkerHandler,
} from "../multithreading/workers/WorkerHandler.ts";
import { WorkerPool } from "../multithreading/WorkerPool.ts";
import type { CrisprInterface } from "../reconstruct/CRISPR.ts";
import { Genus } from "./Genus.ts";
import { Mutator } from "./Mutator.ts";
import { PlateauDetector } from "./PlateauDetector.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayQueue,
} from "./DiscoveryReplayQueue.ts";
import { getLogger } from "../utils/Logger.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

// Extracted modules
import * as evolution from "./NeatEvolution.ts";
import * as scheduling from "./NeatScheduling.ts";

/**
 * NEAT (NeuroEvolution of Augmenting Topologies) implementation.
 *
 * This class implements the NEAT algorithm for evolving neural networks.
 * NEAT is a genetic algorithm that evolves both the topology and weights
 * of neural networks simultaneously.
 *
 * @example
 * ```ts
 * const neat = new Neat(2, 1, options, workers);
 * const result = await neat.evolve();
 * ```
 */
export class Neat {
  /** Number of input neurons in the networks */
  readonly input: number;
  /** Number of output neurons in the networks */
  readonly output: number;
  /** Configuration settings for the NEAT algorithm */
  readonly config: NeatConfig;
  /** Array of worker handlers for parallel processing */
  readonly workers: WorkerHandler[];
  /** Fitness evaluation system */
  readonly fitness: Fitness;

  /** Timestamp when evolution should end (if timeout is set) */
  readonly endTimeTS: number;
  /** Current population of creatures */
  population: Creature[];
  /** Available CRISPR modifications for targeted evolution (read-only after init) */
  readonly CRISPRs: CrisprInterface[];

  /**
   * Current index into the CRISPRs array for round-robin cycling.
   * Issue #1669: Tracks which CRISPR to try next across generations.
   */
  crisprIndex = 0;
  /** Plateau detector for fitness stagnation detection (Issue #1039) */
  readonly plateauDetector: PlateauDetector;

  /** Adaptive fine-tune population tracker (Issue #1323) */
  readonly fineTuneTracker: AdaptiveFineTuneTracker;

  /**
   * Discovery replay queue for non-blocking background replay of cached
   * discoveries against new fittest creatures (Issue #997).
   */
  readonly discoveryReplayQueue: DiscoveryReplayQueue;

  /**
   * Worker pool with work-stealing queues for better load balancing (Issue #1290).
   */
  readonly workerPool: WorkerPool;

  /** Data directory for discovery replay (Issue #997) */
  dataDir?: string;

  /** Count of critical-level evictions; used to throttle memory log noise (Issue #1565). */
  memoryCriticalEvictionCount?: number;

  /** Count of warning-level evictions; used to throttle memory log noise (Issue #2070). */
  memoryWarningEvictionCount?: number;

  // Scheduling state - accessed by extracted scheduling/evolution modules
  doNotStartMore = false;
  private cleanUpDelayCount = 0;
  additionalGenerationCount = 0;
  private discoveryWaitGenerations = 0;
  private maxDiscoveryWaitGenerations = 0;
  trainingInProgress = new Map<string, Promise<void>>();
  discoveryInProgress = new Map<string, Promise<void>>();
  discoveryComplete: ResponseData[] = [];
  trainingComplete: ResponseData[] = [];
  alreadyScheduledMap = new Map<string, number>();
  lastDiscoveryDurationMS = 0;
  readonly MIN_DISCOVERY_TIME_MINUTES = 2;

  constructor(
    input: number,
    output: number,
    options: NeatOptions,
    workers: WorkerHandler[],
  ) {
    this.input = input;
    this.output = output;
    this.workers = workers;

    this.config = createNeatConfig(options);

    this.fitness = new Fitness(
      this.workers,
      this.config.costOfGrowth,
      this.config.feedbackLoop,
      this.config.parallelEvaluation,
    );

    this.population = [];
    this.config.creatures.forEach((c) => {
      const n = Creature.fromJSON(c);
      this.population.push(n);
    });

    this.endTimeTS = options.timeoutMinutes
      ? Date.now() + Math.max(1, options.timeoutMinutes) * 60_000
      : 0;
    this.CRISPRs = Neat.deepCloneAndShuffle(this.config.CRISPRs);

    this.plateauDetector = new PlateauDetector(this.config.plateauDetection);

    this.fineTuneTracker = new AdaptiveFineTuneTracker(
      this.config.fineTunePopulation,
    );

    this.discoveryReplayQueue = new DiscoveryReplayQueue();

    this.workerPool = new WorkerPool(this.workers);
  }

  setDataDir(dataDir: string): void {
    this.dataDir = dataDir;
  }

  static deepCloneAndShuffle<T>(arr: T[]): T[] {
    if (arr.length === 0) return [];

    const cloned = JSON.parse(JSON.stringify(arr)) as T[];

    const rng = getRandomNumberGenerator();
    for (let i = cloned.length - 1; i > 0; i--) {
      const j = Math.floor(rng.random() * (i + 1));
      [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
    }
    return cloned;
  }

  finishUp(
    iterations?: number,
    endTimeMS?: number,
    startTimeMS?: number,
    currentGeneration?: number,
  ) {
    this.doNotStartMore = true;

    if (!this.cleanUpDelayCount) {
      if (
        this.discoveryInProgress.size > 0 || this.trainingInProgress.size > 0
      ) {
        this.cleanUpDelayCount = 2;
        getLogger().info(
          `Set training/discovery clean up count to ${this.cleanUpDelayCount}`,
        );
      }
    }

    if (this.discoveryInProgress.size > 0) {
      if (this.maxDiscoveryWaitGenerations === 0) {
        const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000;
        let maxWaitByIterations = 20;
        let maxWaitByTime = 20;

        if (iterations) {
          maxWaitByIterations = Math.max(1, Math.floor(iterations * 0.5));
        }

        if (startTimeMS && currentGeneration && currentGeneration > 0) {
          const elapsedMS = Date.now() - startTimeMS;
          const avgTimePerGeneration = elapsedMS / currentGeneration;

          if (avgTimePerGeneration > 0) {
            const maxGenerationsIn5Minutes = Math.max(
              1,
              Math.floor(DEFAULT_MAX_WAIT_MS / avgTimePerGeneration),
            );

            if (endTimeMS) {
              const remainingTimeMS = endTimeMS - Date.now();
              if (remainingTimeMS > 0) {
                const estimatedGenerations = Math.max(
                  1,
                  Math.floor(remainingTimeMS / avgTimePerGeneration),
                );
                maxWaitByTime = Math.floor(estimatedGenerations * 0.5);
              }
            } else {
              maxWaitByTime = maxGenerationsIn5Minutes;
            }

            getLogger().info(
              `Avg time per generation: ${
                Math.round(avgTimePerGeneration)
              }ms, max wait: ${maxGenerationsIn5Minutes} generations in 5 minutes`,
            );
          }
        } else if (endTimeMS) {
          const remainingTimeMS = endTimeMS - Date.now();
          if (remainingTimeMS > 0) {
            const estimatedGenerations = Math.max(
              1,
              Math.floor(remainingTimeMS / 30000),
            );
            maxWaitByTime = Math.floor(estimatedGenerations * 0.5);
          }
        }

        this.maxDiscoveryWaitGenerations = Math.min(
          maxWaitByIterations,
          maxWaitByTime,
        );
        getLogger().info(
          `Discovery timeout set to ${this.maxDiscoveryWaitGenerations} generations (based on limiting factor)`,
        );
      }

      this.discoveryWaitGenerations++;

      if (this.discoveryWaitGenerations >= this.maxDiscoveryWaitGenerations) {
        const stuckUUIDs = Array.from(this.discoveryInProgress.keys()).map(
          (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
        );
        getLogger().warn(
          `[Neat] Discovery timeout reached after ${this.discoveryWaitGenerations} generations. Clearing stuck discoveries: ${
            stuckUUIDs.join(", ")
          }`,
        );

        this.discoveryInProgress.clear();
        this.discoveryWaitGenerations = 0;
        this.maxDiscoveryWaitGenerations = 0;

        return false;
      }

      const inProgressUUIDs = Array.from(this.discoveryInProgress.keys()).map(
        (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
      );
      getLogger().info(
        `[Neat] Waiting for discovery to complete (${this.discoveryWaitGenerations}/${this.maxDiscoveryWaitGenerations}) - In progress: ${
          inProgressUUIDs.join(", ")
        }`,
      );

      return false;
    }

    if (this.trainingInProgress.size > 0) {
      getLogger().info("Waiting for training to complete");
      return false;
    }

    if (this.cleanUpDelayCount > 0) {
      getLogger().info(
        `Waiting for training/discovery clean up ${this.cleanUpDelayCount}`,
      );
      this.cleanUpDelayCount--;
      return false;
    }
    if (this.additionalGenerationCount > 0) {
      getLogger().info(
        `Waiting for additional generation${
          this.additionalGenerationCount > 1 ? "s" : ""
        }`,
      );
      return false;
    }
    return true;
  }

  // --- Delegated methods ---

  scheduleDiscovery(creature: Creature, timeOutMinutes: number) {
    scheduling.scheduleDiscovery(this, creature, timeOutMinutes);
  }

  scheduleTraining(creature: Creature, trainingTimeOutMinutes: number) {
    scheduling.scheduleTraining(this, creature, trainingTimeOutMinutes);
  }

  logReplaySummary(result: DiscoveryReplayDirResult) {
    scheduling.logReplaySummary(this.config, result);
  }

  evolve(
    previousFittest?: Creature,
  ): Promise<{
    fittest: Creature;
    averageScore: number;
    plateau: {
      onPlateau: boolean;
      generationsOnPlateau: number;
      improvementRate: number | null;
      mutationMultiplier: number;
    };
  }> {
    return evolution.evolve(this, previousFittest);
  }

  writeScores(creatures: Creature[]) {
    if (!this.config.experimentStore) {
      return;
    }

    const baseStorePath = this.config.experimentStore + "/score/";

    for (const creature of creatures) {
      const name = CreatureUtil.makeUUID(creature);
      const dirPath = baseStorePath + name.substring(0, 3);
      ensureDirSync(dirPath);

      const filePath = `${dirPath}/${name.substring(3)}.txt`;
      const scoreText = `${creature.score}`;

      Deno.writeTextFileSync(filePath, scoreText);
    }
  }

  populatePopulation(creature: Creature) {
    const mutator = new Mutator(this.config);
    while (this.population.length < this.config.populationSize - 1) {
      const clonedCreature = creature.shallowClone();
      const creatures = [clonedCreature];
      mutator.mutate(creatures);
      creatures[0].fix();
      this.population.push(creatures[0]);
    }

    this.population.unshift(creature);

    const genus = new Genus();

    for (const creature of this.population) {
      CreatureUtil.makeUUID(creature);
      genus.addCreature(creature);
    }

    const breed = new Breed(genus, this.config);
    const deDuplicator = new DeDuplicator(breed, mutator);
    deDuplicator.perform(this.population);
  }
}
