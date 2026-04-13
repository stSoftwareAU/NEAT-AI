/**
 * Neat.ts - Central class for the NEAT algorithm.
 *
 * Issue #1599: Refactored from 1,312 lines into a ~420-line facade.
 * Responsibilities are delegated to focused modules in src/neat/:
 * - NeatEvolution.ts   - Core evolution loop
 * - NeatScheduling.ts  - Discovery and training task scheduling
 */

import { ensureDirSync } from "@std/fs";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { Fitness } from "@architecture/Fitness.ts";
import { AdaptiveFineTuneTracker } from "@blackbox/AdaptiveFineTuneTracker.ts";
import { Breed } from "@breed/Breed.ts";
import { createNeatConfig, type NeatConfig } from "@config/NeatConfig.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type {
  ResponseData,
  WorkerHandler,
} from "@multithreading/workers/WorkerHandler.ts";
import { WorkerPool } from "@multithreading/WorkerPool.ts";
import type { CrisprInterface } from "@reconstruct/CRISPR.ts";
import { Genus } from "@neat/Genus.ts";
import { Mutator } from "@neat/Mutator.ts";
import { MCMCState } from "@neat/MCMCState.ts";
import { PlateauDetector } from "@neat/PlateauDetector.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayQueue,
} from "@neat/DiscoveryReplayQueue.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

// Extracted modules
import * as evolution from "@neat/NeatEvolution.ts";
import * as scheduling from "@neat/NeatScheduling.ts";

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
  /**
   * Handlers used for fitness evaluation and parallel breeding (Issue #2244).
   * When the pool is partitioned, this is the fast prefix only — the same
   * threads that never run discovery or training — so breeding does not queue
   * behind long-running heavy work.
   */
  readonly fastWorkerHandlers: WorkerHandler[];
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

  /** Issue #2200: MCMC temperature state for Metropolis-Hastings acceptance */
  readonly mcmcState: MCMCState;

  /** Adaptive fine-tune population tracker (Issue #1323) */
  readonly fineTuneTracker: AdaptiveFineTuneTracker;

  /**
   * Discovery replay queue for non-blocking background replay of cached
   * discoveries against new fittest creatures (Issue #997).
   */
  readonly discoveryReplayQueue: DiscoveryReplayQueue;

  /**
   * Fast worker pool (Issue #2244): same handlers as fitness evaluation.
   * Discovery and training use {@link Neat.heavyWorkerPool} only.
   */
  readonly fastWorkerPool: WorkerPool;

  /**
   * Heavy worker pool (Issue #2244): discovery and training scheduling only.
   * When not partitioned (e.g. `threads <= 2`), this is the same instance as
   * {@link Neat.fastWorkerPool}.
   */
  readonly heavyWorkerPool: WorkerPool;

  /**
   * Alias of {@link Neat.fastWorkerPool} for backwards compatibility (Issue #2244).
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

  /**
   * @param input - Number of input neurons
   * @param output - Number of output neurons
   * @param options - NEAT configuration options
   * @param workers - All workers, ordered `[fast..., heavy...]` when
   *   `fastWorkers` is provided — heavy suffix must match
   *   `workers.slice(fastWorkers.length)`. Parallel breeding uses only
   *   {@link Neat.fastWorkerHandlers} (same as fitness) so it never queues
   *   behind discovery or training on heavy threads.
   * @param fastWorkers - Issue #2244/#2245: Prefix of `workers` dedicated to
   *   fitness evaluation. Heavy handlers are `workers.slice(fastWorkers.length)`.
   *   When omitted, all workers serve both roles (single shared pool).
   */
  constructor(
    input: number,
    output: number,
    options: NeatOptions,
    workers: WorkerHandler[],
    fastWorkers?: WorkerHandler[],
  ) {
    this.input = input;
    this.output = output;
    this.workers = workers;

    this.config = createNeatConfig(options);

    const fastHandlers = fastWorkers ?? this.workers;
    this.fastWorkerHandlers = fastHandlers;

    // Issue #2245: Use fast-pool workers for fitness evaluation when available.
    // Fast-pool workers are dedicated to evaluation and never run discovery
    // or training, eliminating the need for isRunningLongTask() filtering.
    this.fitness = new Fitness(
      fastHandlers,
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

    // Issue #2200: Initialise MCMC temperature state
    this.mcmcState = new MCMCState(this.config.mcmc);

    this.fineTuneTracker = new AdaptiveFineTuneTracker(
      this.config.fineTunePopulation,
    );

    this.discoveryReplayQueue = new DiscoveryReplayQueue();

    const partitioned = fastWorkers !== undefined &&
      fastWorkers.length < this.workers.length;
    const heavyHandlers = partitioned
      ? this.workers.slice(fastWorkers!.length)
      : fastHandlers;

    this.fastWorkerPool = new WorkerPool(fastHandlers);
    this.heavyWorkerPool = partitioned
      ? new WorkerPool(heavyHandlers)
      : this.fastWorkerPool;
    this.workerPool = this.fastWorkerPool;
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
      const trainingUUIDs = Array.from(this.trainingInProgress.keys()).map(
        (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
      );
      getLogger().info(
        `[Neat] Waiting for ${this.trainingInProgress.size} training task(s) ` +
          `to complete - In progress: ${trainingUUIDs.join(", ")}`,
      );
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

  /**
   * Issue #2240: Lightweight wait for in-flight discovery and training tasks.
   *
   * Instead of running full evolve() cycles while waiting for async tasks
   * to complete during the finish-up phase, this method awaits the actual
   * promises using Promise.race with a timeout. This avoids wasting worker
   * resources on unnecessary fitness evaluation, breeding, and mutation.
   *
   * @param timeoutMs - Maximum time to wait before returning (default 30s)
   */
  async awaitInFlightTasks(timeoutMs = 30_000): Promise<void> {
    const inFlightPromises: Promise<void>[] = [
      ...this.discoveryInProgress.values(),
      ...this.trainingInProgress.values(),
    ];

    if (inFlightPromises.length === 0) {
      return;
    }

    const discoveryCount = this.discoveryInProgress.size;
    const trainingCount = this.trainingInProgress.size;
    getLogger().info(
      `[Neat] Awaiting ${inFlightPromises.length} in-flight task(s) ` +
        `(${discoveryCount} discovery, ${trainingCount} training) ` +
        `with ${timeoutMs}ms timeout`,
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs);
    });

    try {
      // Wait until at least one task completes or timeout expires
      await Promise.race([
        Promise.race(inFlightPromises.map((p) => p.catch(() => {}))),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
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
  ): ReturnType<typeof evolution.evolve> {
    return evolution.evolve(this, previousFittest);
  }

  writeScores(creatures: Creature[]) {
    if (!this.config.experimentStore) {
      return;
    }

    const baseStorePath = this.config.experimentStore + "/score/";

    // Issue #2279: Cache created directories to avoid redundant ensureDirSync()
    // calls. Many creatures share the same 3-character UUID prefix directory,
    // so a Set tracks which directories have already been created this batch.
    const createdDirs = new Set<string>();

    for (const creature of creatures) {
      const name = CreatureUtil.makeUUID(creature);
      const dirPath = baseStorePath + name.substring(0, 3);

      if (!createdDirs.has(dirPath)) {
        ensureDirSync(dirPath);
        createdDirs.add(dirPath);
      }

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
