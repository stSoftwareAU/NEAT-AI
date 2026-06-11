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
import { computeHardDeadlineTS } from "@neat/HardDeadline.ts";
import { Mutator } from "@neat/Mutator.ts";
import { MCMCState } from "@neat/MCMCState.ts";
import { PlateauDetector } from "@neat/PlateauDetector.ts";
import { SpeciesPlateauDetector } from "@neat/SpeciesPlateauDetector.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import { SquashEffectivenessTracker } from "@neat/SquashEffectivenessTracker.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayQueue,
} from "@neat/DiscoveryReplayQueue.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { configureSharedSubnetworkIndex } from "@discovery/SubnetworkHashIndex.ts";
import {
  readCurrentGenerationFromCreature,
  readWarmupGenerationsFromCreature,
} from "@architecture/CreatureFactory.ts";

// Extracted modules
import * as evolution from "@neat/NeatEvolution.ts";
import type { EvolveResult } from "@neat/NeatEvolution.ts";
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
  /**
   * Absolute hard-deadline timestamp — the wall-clock cap past which all
   * in-flight work must be abandoned (Issue #2895). 0 when no timeout is set.
   * Enforcement lands in follow-up sub-issues; this is shared plumbing.
   */
  readonly hardDeadlineTS: number;
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

  /**
   * Per-species plateau detector for stagnant-species retirement
   * (Issue #2454). Tracks each species' best raw fitness across
   * generations so stalled species can be halved or dropped from
   * breeding-quota allocation.
   */
  readonly speciesPlateauDetector: SpeciesPlateauDetector;

  /** Issue #2200: MCMC temperature state for Metropolis-Hastings acceptance */
  readonly mcmcState: MCMCState;

  /**
   * Issue #2457: Per-role squash effectiveness tracker.
   *
   * Owned by Neat so the histogram (and pending commits) survive across
   * generations. Passed into each Mutator constructed in `evolve()` so the
   * same tracker drives ModSquash sampling for the entire run.
   */
  readonly squashEffectivenessTracker: SquashEffectivenessTracker;

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

  /**
   * Current effective population size, adjusted by adaptive population sizing.
   *
   * Issue #2316: Tracks the population size across generations when adaptive
   * sizing is enabled. Initialised to `config.populationSize` and updated
   * each generation by `computeAdaptivePopulationSize()`.
   */
  effectivePopulationSize: number;

  /**
   * Seed warm-up generation count from the initial creature tag.
   * Zero means warm-up is disabled (default behaviour).
   */
  warmupGenerations = 0;

  /**
   * Lineage-accumulated generation count — the single source of truth for how
   * many generations this lineage has evolved across **all** runs, not a
   * per-run counter (Issue #2908).
   *
   * Production runs last ~15 min at ~1 min/generation, so the count must
   * persist across runs to ever reach a `warmupGenerations` of 1440. It is:
   * - seeded monotonically from the saved `currentGeneration` tag at load
   *   (`populatePopulation` folds the tag in via `Math.max`, never lowering it);
   * - strictly ascending during a run (the only mid-run writer is the
   *   per-generation increment at the start of `evolve`);
   * - never reset or lowered by any path.
   *
   * The on-disk tag name remains `currentGeneration`.
   */
  currentGeneration = 0;

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
  // Issue #2871: bound the finish-up wait for optional training tasks the same
  // way discovery is bounded, so an orphaned (never-settling) training promise
  // can never wedge the run from finalizing and checking in the best creature.
  private trainingWaitGenerations = 0;
  private maxTrainingWaitGenerations = 0;
  trainingInProgress = new Map<string, Promise<void>>();
  discoveryInProgress = new Map<string, Promise<void>>();
  discoveryComplete: ResponseData[] = [];
  trainingComplete: ResponseData[] = [];
  alreadyScheduledMap = new Map<string, number>();
  /**
   * Issue #2382: tracks per-creature training regression history so
   * {@link scheduleTraining} can skip creatures that have consecutively
   * regressed instead of spending heavy worker cycles on another rollback.
   */
  readonly trainingRegressionTracker: TrainingRegressionTracker =
    new TrainingRegressionTracker();
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

    // Issue #2531: size the in-process subnetwork hash index according to the
    // configured limit (default 50,000; 0 disables indexing). This is a
    // process-global secondary cache, so the most recent constructor wins.
    configureSharedSubnetworkIndex(this.config.subnetworkIndexSize);

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
      undefined,
      // Issue #2745: Forward the configured cost name to the batch rust
      // scorer so the native scorer computes the same cost as the TS
      // training loop instead of silently defaulting to MSE.
      this.config.costName,
    );

    this.population = [];
    this.config.creatures.forEach((c) => {
      const n = Creature.fromJSON(c);
      this.population.push(n);
    });

    const startTS = Date.now();
    this.endTimeTS = options.timeoutMinutes
      ? startTS + Math.max(1, options.timeoutMinutes) * 60_000
      : 0;
    // Issue #2895: shared absolute hard cap (endTimeTS + clamped grace). 0 when
    // no timeout is configured, mirroring endTimeTS.
    this.hardDeadlineTS = computeHardDeadlineTS(
      startTS,
      options.timeoutMinutes ?? 0,
    ) ?? 0;
    this.CRISPRs = Neat.deepCloneAndShuffle(this.config.CRISPRs);

    this.plateauDetector = new PlateauDetector(this.config.plateauDetection);

    // Issue #2454: Per-species stagnation detector. The detector is a
    // no-op when `speciesStagnation.enabled` is false.
    this.speciesPlateauDetector = new SpeciesPlateauDetector(
      this.config.speciesStagnation,
    );

    // Issue #2200: Initialise MCMC temperature state
    this.mcmcState = new MCMCState(this.config.mcmc);

    // Issue #2457: Initialise the per-role squash effectiveness tracker.
    this.squashEffectivenessTracker = new SquashEffectivenessTracker(
      this.config.squashEffectiveness,
    );

    this.fineTuneTracker = new AdaptiveFineTuneTracker(
      this.config.fineTunePopulation,
    );

    this.discoveryReplayQueue = new DiscoveryReplayQueue();

    // Issue #2316: Initialise effective population size from config.
    // Updated each generation when adaptive population sizing is enabled.
    this.effectivePopulationSize = this.config.populationSize;

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
    // Issue #2422: Propagate to Fitness so batch rust scoring can spawn
    // `rust_scorer` once per generation with the dataset directory.
    this.fitness.setDataDir(dataDir);
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

  /**
   * Compute the bounded number of finish-up generations to wait for an
   * optional in-flight phase (discovery or training) before abandoning it.
   *
   * Issue #2871: extracted from the discovery branch of {@link finishUp} so
   * training is bounded by the identical limiting-factor logic — the smaller
   * of an iteration-derived cap and a wall-clock-derived cap (Issue #2432).
   */
  private computeMaxWaitGenerations(
    iterations?: number,
    endTimeMS?: number,
    startTimeMS?: number,
    currentGeneration?: number,
  ): number {
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
          } else {
            // Issue #2432: wall-clock deadline already exceeded — keep the
            // grace window tight (1 generation) so a stuck task does not
            // silently extend the caller's --timeout into an unbounded
            // generation-count wait.
            maxWaitByTime = 1;
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
      } else {
        // Issue #2432: same wall-clock guard as above.
        maxWaitByTime = 1;
      }
    }

    return Math.max(1, Math.min(maxWaitByIterations, maxWaitByTime));
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
        this.maxDiscoveryWaitGenerations = this.computeMaxWaitGenerations(
          iterations,
          endTimeMS,
          startTimeMS,
          currentGeneration,
        );
        getLogger().info(
          `Discovery timeout set to ${this.maxDiscoveryWaitGenerations} generations (based on limiting factor)`,
        );
      }

      this.discoveryWaitGenerations++;

      // Issue #2432: even after the generation-count wait was decided, the
      // wall-clock deadline takes precedence. If the caller's --timeout has
      // expired while we were waiting, do not let the generation count keep
      // the loop alive.
      const wallClockExpired = endTimeMS !== undefined && endTimeMS > 0 &&
        Date.now() >= endTimeMS;

      if (
        wallClockExpired ||
        this.discoveryWaitGenerations >= this.maxDiscoveryWaitGenerations
      ) {
        const stuckUUIDs = Array.from(this.discoveryInProgress.keys()).map(
          (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
        );
        const reason = wallClockExpired
          ? "wall-clock deadline expired"
          : `${this.discoveryWaitGenerations} generations`;
        getLogger().warn(
          `[Neat] Discovery timeout reached after ${reason}. Clearing stuck discoveries: ${
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
      // Issue #2871: training is an optional/best-effort phase. Bound the wait
      // exactly like discovery so an orphaned training promise that never
      // settles (e.g. a timed-out per-creature CPU score whose worker task is
      // never reaped) cannot keep the run from finalizing and checking in the
      // best-so-far creature.
      if (this.maxTrainingWaitGenerations === 0) {
        this.maxTrainingWaitGenerations = this.computeMaxWaitGenerations(
          iterations,
          endTimeMS,
          startTimeMS,
          currentGeneration,
        );
        getLogger().info(
          `Training timeout set to ${this.maxTrainingWaitGenerations} generations (based on limiting factor)`,
        );
      }

      this.trainingWaitGenerations++;

      // The wall-clock deadline takes precedence over the generation-count
      // wait: once the caller's --timeout has expired we must not let a stuck
      // training task keep the loop alive.
      const wallClockExpired = endTimeMS !== undefined && endTimeMS > 0 &&
        Date.now() >= endTimeMS;

      if (
        wallClockExpired ||
        this.trainingWaitGenerations >= this.maxTrainingWaitGenerations
      ) {
        const stuckUUIDs = Array.from(this.trainingInProgress.keys()).map(
          (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
        );
        const reason = wallClockExpired
          ? "wall-clock deadline expired"
          : `${this.trainingWaitGenerations} generations`;
        getLogger().warn(
          `[Neat] Training timeout reached after ${reason}. Abandoning stuck training task(s): ${
            stuckUUIDs.join(", ")
          }`,
        );

        this.trainingInProgress.clear();
        this.trainingWaitGenerations = 0;
        this.maxTrainingWaitGenerations = 0;

        return false;
      }

      const trainingUUIDs = Array.from(this.trainingInProgress.keys()).map(
        (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
      );
      getLogger().info(
        `[Neat] Waiting for ${this.trainingInProgress.size} training task(s) ` +
          `to complete (${this.trainingWaitGenerations}/${this.maxTrainingWaitGenerations}) - In progress: ${
            trainingUUIDs.join(", ")
          }`,
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
   * Issue #2896: enforce the absolute T+15 hard cap during the finish-up cycle.
   *
   * When `hardDeadlineMS` is set (non-zero) and already in the past, abandon all
   * in-flight discovery/training bookkeeping — so the abandoned promises cannot
   * be re-awaited — and signal the caller to break out of the evolve loop, even
   * when {@link finishUp} would still ask for more wait generations. The
   * caller's post-loop sequence (worker termination, best-creature restore and
   * `writeCreatures`) still runs because the break lands there.
   *
   * @param hardDeadlineMS Absolute hard-deadline epoch ms (0/unset = no cap).
   * @returns `true` when the cap was exceeded and the loop must break.
   */
  abandonInFlightPastHardDeadline(hardDeadlineMS: number): boolean {
    if (!hardDeadlineMS || Date.now() <= hardDeadlineMS) {
      return false;
    }

    const abandoned = this.discoveryInProgress.size +
      this.trainingInProgress.size;
    getLogger().warn(
      `[Neat] Hard deadline (timeoutMinutes + grace) exceeded — abandoning ${abandoned} in-flight task(s)`,
    );
    this.discoveryInProgress.clear();
    this.trainingInProgress.clear();
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
   * @param hardDeadlineTS - Absolute hard-deadline epoch ms (Issue #2896).
   *   Defaults to this instance's {@link hardDeadlineTS}. The effective wait is
   *   capped at `hardDeadlineTS - Date.now()` (minimum 0) so the 30s default
   *   cannot push the finish-up wait past the T+15 cap. 0 disables the cap.
   */
  async awaitInFlightTasks(
    timeoutMs = 30_000,
    hardDeadlineTS = this.hardDeadlineTS,
  ): Promise<void> {
    const inFlightPromises: Promise<void>[] = [
      ...this.discoveryInProgress.values(),
      ...this.trainingInProgress.values(),
    ];

    if (inFlightPromises.length === 0) {
      return;
    }

    // Issue #2896: never wait past the absolute hard deadline. Cap the effective
    // timeout at the time remaining before the cap (minimum 0).
    const effectiveTimeoutMs = hardDeadlineTS > 0
      ? Math.min(timeoutMs, Math.max(0, hardDeadlineTS - Date.now()))
      : timeoutMs;

    const discoveryCount = this.discoveryInProgress.size;
    const trainingCount = this.trainingInProgress.size;
    getLogger().info(
      `[Neat] Awaiting ${inFlightPromises.length} in-flight task(s) ` +
        `(${discoveryCount} discovery, ${trainingCount} training) ` +
        `with ${effectiveTimeoutMs}ms timeout`,
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, effectiveTimeoutMs);
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
  ): Promise<EvolveResult> {
    return evolution.evolve(this, previousFittest);
  }

  /**
   * Write creature scores to the experiment store.
   *
   * Issue #2275: Converted to async I/O with directory creation caching.
   * Benchmarks showed 23-38% improvement over the previous synchronous
   * approach (which called ensureDirSync + Deno.writeTextFileSync per
   * creature). Directory creation is cached in a Set to skip redundant
   * ensureDirSync calls, and file writes use Deno.writeTextFile with
   * Promise.all batching to unblock the event loop.
   */
  async writeScores(creatures: Creature[]): Promise<void> {
    if (!this.config.experimentStore) {
      return;
    }

    const baseStorePath = this.config.experimentStore + "/score/";
    const writes: Promise<void>[] = [];

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

      writes.push(Deno.writeTextFile(filePath, scoreText));
    }

    await Promise.all(writes);
  }

  async populatePopulation(creature: Creature) {
    this.warmupGenerations = readWarmupGenerationsFromCreature(creature);
    // Issue #2908: seed the lineage-accumulated generation counter
    // monotonically — fold the saved tag in via Math.max so no load path can
    // ever lower it (consistent with the monotonic tag write in #2831).
    this.currentGeneration = Math.max(
      this.currentGeneration,
      readCurrentGenerationFromCreature(creature),
    );

    const mutator = new Mutator(
      this.config,
      undefined,
      undefined,
      this.squashEffectivenessTracker,
    );
    mutator.setWarmupContext(this.warmupGenerations, this.currentGeneration);
    while (this.population.length < this.config.populationSize - 1) {
      const clonedCreature = creature.shallowClone();
      const creatures = [clonedCreature];
      mutator.mutate(creatures);
      // Issue #2302: Pass forwardOnly so self-connections are removed from
      // unmutated clones of forward-only creatures (fix() without the flag
      // preserves self-loops, which later crash prepareCreatureForBreeding).
      const isForwardOnly = creatures[0].forwardOnly === true ||
        (this.config.feedbackLoop !== true &&
          creatures[0].forwardOnly !== false);
      creatures[0].fix(isForwardOnly ? { forwardOnly: true } : undefined);
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
    await deDuplicator.perform(this.population);
  }
}
