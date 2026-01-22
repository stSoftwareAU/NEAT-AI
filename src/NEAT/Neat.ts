import { assert } from "@std/assert";
import { blue } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { ensureDirSync } from "@std/fs";
import { addTag, getTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { DeDuplicator } from "../architecture/DeDuplicator.ts";
import {
  makeElitists,
  sortCreaturesByScore,
} from "../architecture/ElitismUtils.ts";
import { Fitness } from "../architecture/Fitness.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import { fineTuneImprovement } from "../blackbox/FineTune.ts";
import { FindTunePopulation } from "../blackbox/FineTunePopulation.ts";
import { Breed } from "../breed/Breed.ts";
import { ParallelBreeding } from "../breed/ParallelBreeding.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import type { TrainOptions } from "../config/TrainOptions.ts";

import type {
  ResponseData,
  WorkerHandler,
} from "../multithreading/workers/WorkerHandler.ts";
import { AddConnection } from "../mutate/AddConnection.ts";
import { Genus } from "./Genus.ts";
import type { Approach } from "./LogApproach.ts";
import { Mutator } from "./Mutator.ts";
import { CRISPR, type CrisprInterface } from "../reconstruct/CRISPR.ts";
import { simplify } from "../optimize/Simplify.ts";
import { DiscoverStructure } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { isRustDiscoveryEnabled } from "../architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { validateAfterDiscoveryOrThrow } from "../discovery/DiscoveryPostValidate.ts";
import { PlateauDetector } from "./PlateauDetector.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayQueue,
} from "./DiscoveryReplayQueue.ts";

/**
 * NEAT (NeuroEvolution of Augmenting Topologies) implementation.
 *
 * This class implements the NEAT algorithm for evolving neural networks.
 * NEAT is a genetic algorithm that evolves both the topology and weights
 * of neural networks simultaneously.
 *
 * Key features:
 * - Population management and evolution
 * - Species-based selection and reproduction
 * - Mutation and crossover operations
 * - Fitness evaluation and scoring
 * - Multi-threaded training and discovery
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
  /** Available CRISPR modifications for targeted evolution */
  CRISPRs: CrisprInterface[];
  /** Plateau detector for fitness stagnation detection (Issue #1039) */
  readonly plateauDetector: PlateauDetector;

  /**
   * Discovery replay queue for non-blocking background replay of cached
   * discoveries against new fittest creatures (Issue #997).
   */
  readonly discoveryReplayQueue: DiscoveryReplayQueue;

  /** Data directory for discovery replay (Issue #997) */
  private dataDir?: string;

  /**
   * Creates a new NEAT instance for evolving neural networks.
   *
   * @param input - Number of input neurons in the networks
   * @param output - Number of output neurons in the networks
   * @param options - Configuration options for the NEAT algorithm
   * @param workers - Array of worker handlers for parallel processing
   */
  constructor(
    input: number,
    output: number,
    options: NeatOptions,
    workers: WorkerHandler[],
  ) {
    this.input = input; // The input size of the networks
    this.output = output; // The output size of the networks
    this.workers = workers;

    // Custom cost functions are now handled by file path in WorkerHandler
    // No registration needed in the main thread

    this.config = createNeatConfig(options);

    // The fitness function to evaluate the networks
    this.fitness = new Fitness(
      this.workers,
      this.config.costOfGrowth,
      this.config.feedbackLoop,
    );

    // Initialize the genomes
    this.population = [];
    this.config.creatures.forEach((c) => {
      const n = Creature.fromJSON(c);
      this.population.push(n);
    });

    this.endTimeTS = options.timeoutMinutes
      ? Date.now() + Math.max(1, options.timeoutMinutes) * 60_000
      : 0;
    this.CRISPRs = Neat.deepCloneAndShuffle(this.config.CRISPRs);

    // Initialize plateau detector (Issue #1039)
    this.plateauDetector = new PlateauDetector(this.config.plateauDetection);

    // Initialize discovery replay queue (Issue #997)
    this.discoveryReplayQueue = new DiscoveryReplayQueue();
  }

  /**
   * Set the data directory for discovery replay (Issue #997).
   * This is needed because the Neat class doesn't have direct access to the
   * data directory - it's typically passed to evolveDir in Creature.
   *
   * @param dataDir The data directory containing training data
   */
  setDataDir(dataDir: string): void {
    this.dataDir = dataDir;
  }

  /**
   * Deep clones and shuffles an array using JSON serialization.
   *
   * @param arr - The array to clone and shuffle
   * @returns A new shuffled array with deep-cloned elements
   */
  static deepCloneAndShuffle<T>(arr: T[]): T[] {
    if (arr.length === 0) return [];

    // Deep clone using JSON — can fail with non-serializable fields
    const cloned = JSON.parse(JSON.stringify(arr)) as T[];

    // Shuffle (Fisher-Yates)
    for (let i = cloned.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
    }
    return cloned;
  }

  private doNotStartMore = false;
  private cleanUpDelayCount = 0;
  private additionalGenerationCount = 0;
  private discoveryWaitGenerations = 0;
  private maxDiscoveryWaitGenerations = 0;

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
        console.info(
          `Set training/discovery clean up count to ${this.cleanUpDelayCount}`,
        );
      }
    }

    if (this.discoveryInProgress.size > 0) {
      // Calculate max wait generations on first discovery wait
      if (this.maxDiscoveryWaitGenerations === 0) {
        const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
        let maxWaitByIterations = 20; // Default fallback
        let maxWaitByTime = 20; // Default fallback

        if (iterations) {
          maxWaitByIterations = Math.max(1, Math.floor(iterations * 0.5));
        }

        // Calculate based on actual average time per generation if available
        if (startTimeMS && currentGeneration && currentGeneration > 0) {
          const elapsedMS = Date.now() - startTimeMS;
          const avgTimePerGeneration = elapsedMS / currentGeneration;

          if (avgTimePerGeneration > 0) {
            // Calculate how many generations fit in 5 minutes
            const maxGenerationsIn5Minutes = Math.max(
              1,
              Math.floor(DEFAULT_MAX_WAIT_MS / avgTimePerGeneration),
            );

            // If we have endTimeMS, also calculate based on remaining time
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
              // Use the 5-minute limit if no endTimeMS
              maxWaitByTime = maxGenerationsIn5Minutes;
            }

            console.info(
              `Avg time per generation: ${
                Math.round(avgTimePerGeneration)
              }ms, max wait: ${maxGenerationsIn5Minutes} generations in 5 minutes`,
            );
          }
        } else if (endTimeMS) {
          // Fallback to old estimation if we don't have timing data
          const remainingTimeMS = endTimeMS - Date.now();
          if (remainingTimeMS > 0) {
            // Estimate generations based on remaining time (assume 1 generation per 30 seconds as rough estimate)
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
        console.info(
          `Discovery timeout set to ${this.maxDiscoveryWaitGenerations} generations (based on limiting factor)`,
        );
      }

      this.discoveryWaitGenerations++;

      if (this.discoveryWaitGenerations >= this.maxDiscoveryWaitGenerations) {
        const stuckUUIDs = Array.from(this.discoveryInProgress.keys()).map(
          (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
        );
        console.warn(
          `[Neat] Discovery timeout reached after ${this.discoveryWaitGenerations} generations. Clearing stuck discoveries: ${
            stuckUUIDs.join(", ")
          }`,
        );

        // Clear stuck discoveries to allow evolution to complete
        this.discoveryInProgress.clear();
        this.discoveryWaitGenerations = 0;
        this.maxDiscoveryWaitGenerations = 0;

        return false; // Continue to next iteration to check other conditions
      }

      const inProgressUUIDs = Array.from(this.discoveryInProgress.keys()).map(
        (uuid) => uuid.substring(Math.max(0, uuid.length - 8)),
      );
      console.info(
        `[Neat] Waiting for discovery to complete (${this.discoveryWaitGenerations}/${this.maxDiscoveryWaitGenerations}) - In progress: ${
          inProgressUUIDs.join(", ")
        }`,
      );

      return false;
    }

    if (this.trainingInProgress.size > 0) {
      console.info("Waiting for training to complete");
      return false;
    }

    if (this.cleanUpDelayCount > 0) {
      console.info(
        `Waiting for training/discovery clean up ${this.cleanUpDelayCount}`,
      );
      this.cleanUpDelayCount--;
      return false;
    }
    if (this.additionalGenerationCount > 0) {
      console.info(
        `Waiting for additional generation${
          this.additionalGenerationCount > 1 ? "s" : ""
        }`,
      );
      return false;
    }
    return true;
  }

  private trainingInProgress = new Map<string, Promise<void>>();
  private discoveryInProgress = new Map<string, Promise<void>>();
  discoveryComplete: ResponseData[] = [];
  trainingComplete: ResponseData[] = [];

  private alreadyScheduledMap = new Map<string, number>();
  private lastDiscoveryDurationMS = 0;
  private readonly MIN_DISCOVERY_TIME_MINUTES = 2;

  scheduleDiscovery(creature: Creature, timeOutMinutes: number) {
    if (this.config.discoverySampleRate <= 0) {
      return;
    }

    // Skip discovery if timeout is 0 or negative (discovery disabled)
    if (
      timeOutMinutes <= 0 || this.config.discoveryRecordTimeOutMinutes <= 0
    ) {
      return;
    }

    // Skip discovery if Rust library or GPU is not available
    if (!isRustDiscoveryEnabled()) {
      return;
    }

    if (this.doNotStartMore) return;

    if (this.discoveryInProgress.size > 0) return;

    const uuid = CreatureUtil.makeUUID(creature);

    let w: WorkerHandler;

    w = this.workers[Math.floor(this.workers.length * Math.random())];

    if (w.isBusy()) {
      for (let i = this.workers.length; i--;) {
        const tmpWorker = this.workers[i];
        if (!tmpWorker.isBusy()) {
          w = tmpWorker;
          break;
        }
      }
    }

    if (this.config.verbose) {
      console.info(
        `Discovery ${
          blue(uuid.substring(Math.max(0, uuid.length - 8)))
        } scheduled`,
      );
    }

    // Create a new frozen config with the dynamic timeout override
    const discoveryConfig = createNeatConfig({
      ...this.config,
      discoveryRecordTimeOutMinutes: timeOutMinutes,
    });

    const taskStartTime = Date.now();
    if (this.config.verbose) {
      console.info(
        `[Neat] Discovery request sent to worker for ${
          blue(uuid.substring(Math.max(0, uuid.length - 8)))
        }`,
      );
    }

    // Use internal timeout handling in DiscoverDirectory.ts instead of external wrapper
    // This allows internal diagnostics to run and partial results to be returned
    const discoveryPromise = w.discover(creature, discoveryConfig);

    const p = discoveryPromise.then((r) => {
      assert(r.discover, "No discovery found");

      const discoveryDurationMS = Date.now() - taskStartTime;
      this.lastDiscoveryDurationMS = discoveryDurationMS;

      if (this.config.verbose) {
        console.info(
          `[Neat] Discovery completed for ${
            blue(uuid.substring(Math.max(0, uuid.length - 8)))
          } after ${(discoveryDurationMS / 1000).toFixed(1)}s`,
        );
      }

      // Issue #1020: Build the improved creature from the original creature.
      // This ensures we apply discovery results to the creature that was analysed,
      // not the current fittest (which may have evolved during discovery).
      // We build ONE improved creature and add it directly to the population.
      const improvedCreature = DiscoverStructure.addHelpfulSynapses(
        uuid,
        creature,
        r.discover.addHelpfulSynapses,
        this.config.discoveryFailureCacheDir,
      );

      if (improvedCreature) {
        // Tag the improved creature to indicate it came from discovery
        addTag(improvedCreature, "approach", "discovered");
        addTag(improvedCreature, "discoveryID", uuid);

        // Store the improved creature JSON in the response for direct population addition
        r.discover.improvedCreature = improvedCreature.exportJSON();

        if (this.config.verbose) {
          console.info(
            `[Neat] Built improved creature from discovery ${
              blue(uuid.substring(Math.max(0, uuid.length - 8)))
            } with ${
              r.discover.addHelpfulSynapses?.length ?? 0
            } synapses added`,
          );
        }
      }

      this.discoveryComplete.push(r);

      this.discoveryInProgress.delete(uuid);
    }).catch((error) => {
      console.error(
        `[Neat] Discovery failed for creature ${
          uuid.substring(Math.max(0, uuid.length - 8))
        } after ${((Date.now() - taskStartTime) / 1000).toFixed(1)}s:`,
        error,
      );

      // Remove from discoveryInProgress to prevent infinite waiting
      this.discoveryInProgress.delete(uuid);

      // Add empty result to avoid breaking downstream logic
      this.discoveryComplete.push({
        taskID: 0,
        duration: 0,
        discover: {
          ID: uuid,
        },
      });
    });

    this.discoveryInProgress.set(uuid, p);
  }

  /**
   * Issue #1150: Log a summary of the discovery replay result.
   *
   * This provides visibility into which candidates were evaluated during
   * replay and which ones were successful. The summary is always logged
   * when a replay completes, while detailed candidate information is
   * only logged in verbose mode.
   *
   * @param result The discovery replay result to log
   */
  logReplaySummary(result: DiscoveryReplayDirResult): void {
    const totalEvaluated = result.evaluatedSingles + result.evaluatedCombos;

    // Build the summary parts
    const parts: string[] = [];
    parts.push(`evaluated: ${totalEvaluated}`);
    if (result.evaluatedSingles > 0) {
      parts.push(`singles: ${result.evaluatedSingles}`);
    }
    if (result.evaluatedCombos > 0) {
      parts.push(`combos: ${result.evaluatedCombos}`);
    }
    if (result.pruned > 0) {
      parts.push(`pruned: ${result.pruned}`);
    }
    if (result.skippedAlreadyApplied > 0) {
      parts.push(`already-applied: ${result.skippedAlreadyApplied}`);
    }
    if (result.skippedNotApplicable > 0) {
      parts.push(`not-applicable: ${result.skippedNotApplicable}`);
    }
    if (result.timedOut) {
      parts.push("(timed out)");
    }

    // Log outcome
    if (result.improvement) {
      const changeType = result.improvement.changeType ?? "unknown";
      const scoreDelta = result.improvement.scoreDelta?.toFixed(6) ?? "N/A";
      console.info(
        `[Neat] Discovery replay: ${
          blue(changeType)
        } improved score by ${scoreDelta} (${parts.join(", ")})`,
      );
    } else {
      console.info(
        `[Neat] Discovery replay: no improvement found (${parts.join(", ")})`,
      );
    }

    // In verbose mode, log details of successful single candidates
    if (this.config.verbose && result.evaluations) {
      const successfulCandidates = result.evaluations.filter(
        (e) => e.improved && e.kind !== "original",
      );
      if (successfulCandidates.length > 0) {
        console.info("[Neat] Successful replay candidates:");
        for (const candidate of successfulCandidates) {
          const kind = candidate.kind === "combo" ? "combo" : "single";
          const changeType = candidate.changeType ?? "unknown";
          const description = candidate.description ?? candidate.key ?? "";
          const scoreDelta = candidate.scoreDelta?.toFixed(6) ?? "N/A";
          console.info(
            `  - [${kind}] ${
              blue(changeType)
            }: ${description} (+${scoreDelta})`,
          );
        }
      }
    }
  }

  /**
   * Schedules training for a creature
   * @param creature The creature to train
   * @param trainingTimeOutMinutes The time out in minutes
   */
  scheduleTraining(
    creature: Creature,
    trainingTimeOutMinutes: number,
  ) {
    const uuid = CreatureUtil.makeUUID(creature);
    if (this.trainingInProgress.has(uuid)) return;

    if (this.alreadyScheduledMap.has(uuid)) {
      if (!this.config.enableRepetitiveTraining) {
        return;
      }
    }

    this.alreadyScheduledMap.set(uuid, Date.now());
    if (this.alreadyScheduledMap.size > 1000) {
      // Clean up by removing old entries
      const minuteAgo = Date.now() - 60_000;
      for (const [key, value] of this.alreadyScheduledMap) {
        if (value < minuteAgo) {
          this.alreadyScheduledMap.delete(key);
        }
      }
    }

    let w: WorkerHandler;

    w = this.workers[Math.floor(this.workers.length * Math.random())];

    if (w.isBusy()) {
      for (let i = this.workers.length; i--;) {
        const tmpWorker = this.workers[i];
        if (!tmpWorker.isBusy()) {
          w = tmpWorker;
          break;
        }
      }
    }

    if (this.config.verbose) {
      console.info(
        `Training ${
          blue(uuid.substring(Math.max(0, uuid.length - 8)))
        } scheduled`,
      );
    }

    const trainOptions: TrainOptions = {
      log: this.config.log,
      traceStore: this.config.traceStore,
      iterations: 1,
      targetError: this.config.targetError,
      trainingSampleRate: this.config.trainingSampleRate,
      disableRandomSamples: this.config.disableRandomSamples,
      trainingTimeOutMinutes: trainingTimeOutMinutes,
      batchSize: this.config.trainingBatchSize,
      maximumBiasAdjustmentScale: this.config.maximumBiasAdjustmentScale,
      maximumWeightAdjustmentScale: this.config.maximumWeightAdjustmentScale,
      feedbackLoop: this.config.feedbackLoop,
      sparseRatio: this.config.sparseRatio,
    };

    const p = w.train(creature, trainOptions).then((r) => {
      assert(r.train, "No train found");

      const errorTx = getTag(creature, "error");
      assert(errorTx, "No error tag found");

      let trainingImprovement = true;
      if (r.train.error > parseFloat(errorTx)) {
        console.warn(
          `Training ${
            blue(r.train.ID)
          } caused a higher error of ${r.train.error} from ${errorTx}`,
        );
        trainingImprovement = false;
      }
      const trainedCreature = Creature.fromJSON(JSON.parse(r.train.creature));
      trainedCreature.score = calculateScore(
        trainedCreature,
        r.train.error,
        this.config.costOfGrowth,
      );
      const backtracked = fineTuneImprovement(
        creature,
        trainedCreature,
        this.config.feedbackLoop,
        1,
        true,
      );
      const forward = fineTuneImprovement(
        creature,
        trainedCreature,
        this.config.feedbackLoop,
        1,
        false,
      );

      if (backtracked.length > 0 || forward.length > 0) {
        const untrainedError = getTag(trainedCreature, "untrained-error");
        if (backtracked.length > 0) {
          const backtrackedCreature = backtracked[0].exportJSON();
          addTag(backtrackedCreature, "trainID", r.train.ID);
          addTag(backtrackedCreature, "trainVariant", "overshot");
          if (untrainedError) {
            addTag(backtrackedCreature, "untrained-error", untrainedError);
          }
          r.train.backtracked = JSON.stringify(backtrackedCreature);
        }
        if (forward.length > 0) {
          const forwardCreature = forward[0].exportJSON();
          addTag(forwardCreature, "trainID", r.train.ID);
          addTag(forwardCreature, "trainVariant", "undershot");
          if (untrainedError) {
            addTag(forwardCreature, "untrained-error", untrainedError);
          }
          r.train.forward = JSON.stringify(forwardCreature);
        }
      } else if (trainingImprovement === false) {
        console.warn(
          `Training ${
            blue(r.train.ID)
          } caused a higher error of ${r.train.error} from ${errorTx} and no tuning`,
        );
      }

      this.trainingComplete.push(r);

      this.trainingInProgress.delete(uuid);

      if (this.config.traceStore) {
        if (r.train.trace) {
          const traceNetwork = Creature.fromJSON(
            JSON.parse(r.train.trace),
          );
          CreatureUtil.makeUUID(traceNetwork);
          ensureDirSync(this.config.traceStore);
          Deno.writeTextFileSync(
            `${this.config.traceStore}/${traceNetwork.uuid}.json`,
            JSON.stringify(traceNetwork.traceJSON(), null, 1),
          );
        }
      }
    }).catch((error) => {
      console.error(
        `Training failed for creature ${
          uuid.substring(Math.max(0, uuid.length - 8))
        }:`,
        error,
      );

      // Remove from trainingInProgress to prevent infinite waiting
      this.trainingInProgress.delete(uuid);

      // Add empty result to avoid breaking downstream logic
      this.trainingComplete.push({
        taskID: 0,
        duration: 0,
        train: {
          ID: uuid,
          creature: JSON.stringify(creature.exportJSON()),
          error: Number.POSITIVE_INFINITY,
          trace: "",
        },
      });
    });

    this.trainingInProgress.set(uuid, p);
  }

  /**
   * Evaluates, selects, breeds and mutates population.
   *
   * @param previousFittest - The fittest creature from the previous generation
   * @returns Evolution results including fittest creature, average score, and plateau status
   */
  async evolve(
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
    this.additionalGenerationCount--;

    await this.fitness.calculate(this.population);
    sortCreaturesByScore(this.population);

    const genus = new Genus();

    this.writeScores(
      this.population,
    );

    // The population is already sorted in the desired order
    for (let indx = 0; indx < this.population.length; indx++) {
      const creature = this.population[indx];
      assert(creature.uuid, "UUID missing");
      assert(creature.score, "Score missing");
      assert(
        Number.isFinite(creature.score),
        `Score: ${creature.score} is not finite`,
      );
      genus.addCreature(creature);
    }
    if (this.population.length === 0) {
      console.warn("All creatures died, using zombies");
    }

    const numberOfElitists = this.config.elitism > 1
      ? this.config.elitism
      : previousFittest
      ? this.config.elitism
      : 2;

    /* Elitism: we need at least 2 on the first run */
    const results = makeElitists(
      this.population,
      numberOfElitists,
      this.config.verbose,
    );
    const elitists = results.elitists;

    let tmpFittest = elitists[0];

    assert(tmpFittest.uuid, "Fittest creature has no UUID");
    assert(tmpFittest.score, "No fittest creature score found");
    let previousFittestUUID = "NONE";
    if (previousFittest) {
      previousFittestUUID = previousFittest.uuid ?? "NONE";
      assert(previousFittest.score, "No previous fittest creature score found");
      assert(previousFittest.uuid, "Previous fittest creature has no UUID");
      assert(
        previousFittest.score <= tmpFittest.score,
        "Previous fittest has a higher score than fittest",
      );
      if (previousFittest.score === tmpFittest.score) {
        if (previousFittest.uuid !== tmpFittest.uuid) {
          console.info(
            `Fittest creature ${
              tmpFittest.uuid.substring(0, 8)
            } has the same score as previous fittest ${
              previousFittest.uuid.substring(0, 8)
            } reuse previous fittest.`,
          );
        }
        tmpFittest = previousFittest;
      }
    }

    // Issue #1025: Use shallowClone() instead of fromJSON(exportJSON())
    // for significant performance improvement (3-4x faster for large creatures).
    const fittest = tmpFittest.shallowClone(); // Make a copy so it's not mutated.

    fittest.score = tmpFittest.score;
    assert(fittest.score, "No fittest score found");

    // Issue #1039: Record fitness for plateau detection
    this.plateauDetector.recordFitness(fittest.score);

    addTag(fittest, "score", fittest.score.toString());

    const error = getTag(fittest, "error");
    assert(error, "No error tag found");
    let trainingTimeOutMinutes = 0;
    if (this.endTimeTS) {
      const diff = this.endTimeTS - Date.now();
      trainingTimeOutMinutes = Math.round(diff / 60_000);

      if (trainingTimeOutMinutes < 1) {
        trainingTimeOutMinutes = -1;
      }
    }

    if (previousFittestUUID !== fittest.uuid) {
      const simplified = simplify(fittest);

      if (simplified) {
        elitists.push(simplified);
      }

      if (trainingTimeOutMinutes !== -1) {
        // Estimate if we have enough time for discovery
        const estimatedDiscoveryMinutes = this.lastDiscoveryDurationMS > 0
          ? Math.ceil(this.lastDiscoveryDurationMS / 60000) + 1 // Add 1 min buffer
          : this.MIN_DISCOVERY_TIME_MINUTES;

        if (trainingTimeOutMinutes >= estimatedDiscoveryMinutes) {
          this.scheduleDiscovery(fittest, trainingTimeOutMinutes);
        } else {
          if (this.config.verbose) {
            console.info(
              `Skipping discovery: insufficient time (${trainingTimeOutMinutes}m remaining, ${estimatedDiscoveryMinutes}m estimated)`,
            );
          }
        }
      }

      // Issue #997: Schedule background replay of cached discoveries against the new fittest.
      // This allows learnings from previous discovery runs to be applied when evolution
      // progresses. The replay runs in a non-blocking manner, one at a time.
      // Issue #1113: Pass remaining time to replay so it can timeout gracefully.
      if (this.dataDir && this.config.discoveryCacheDir) {
        this.discoveryReplayQueue.scheduleReplay(
          fittest,
          this.dataDir,
          this.config,
          trainingTimeOutMinutes > 0 ? trainingTimeOutMinutes : undefined,
        );
      }
    }

    if (trainingTimeOutMinutes !== -1) { // If not timed out already
      for (
        let i = 0;
        i < results.elitists.length;
        i++
      ) {
        const n = results.elitists[i];

        if (
          this.doNotStartMore === false &&
          this.trainingInProgress.size < this.config.trainPerGen &&
          Number.isFinite(n.score)
        ) {
          this.scheduleTraining(
            n,
            trainingTimeOutMinutes,
          );
        }
      }
    }

    const dnaPopulation = [];

    if (this.CRISPRs.length) {
      const crispr = new CRISPR(fittest);
      while (this.CRISPRs.length > 0) {
        const dna = this.CRISPRs.pop()!;

        const enhanced = crispr.cleaveDNA(dna);
        if (enhanced.uuid !== fittest.uuid) {
          dnaPopulation.push(enhanced);
          break;
        }
      }
    }
    const newPopulation = [];
    if (
      elitists.length > 0
    ) {
      const n = elitists[0];
      // Issue #1040: Use shallowClone() instead of fromJSON(exportJSON())
      // for better performance - avoids expensive JSON serialisation/deserialisation
      const creativeThinking = n.shallowClone();
      delete creativeThinking.memetic;
      // Clear score to match behaviour of previous JSON clone approach
      // (exportJSON doesn't export score, so fromJSON wouldn't have it)
      delete creativeThinking.score;
      const weightScale = 1 / Math.max(creativeThinking.synapses.length, 1);
      const addConnection = new AddConnection(creativeThinking);
      for (let i = 0; i < this.config.creativeThinkingConnectionCount; i++) {
        addConnection.mutate(
          Math.random() < this.config.focusRate
            ? this.config.focusList
            : undefined,
          {
            weightScale: weightScale,
          },
        );
      }

      assert(!creativeThinking.memetic);
      newPopulation.push(creativeThinking);
    }

    const ftp = new FindTunePopulation(this);
    const fineTunedPopulation = ftp.make(
      fittest,
      previousFittest,
      genus,
    );

    const newPopSize = this.config.populationSize -
      elitists.length -
      dnaPopulation.length -
      this.trainingComplete.length -
      this.discoveryComplete.length -
      fineTunedPopulation.length - 1 -
      newPopulation.length;

    // Issue #1026: Use parallel breeding for improved performance
    // Pass workers for true parallelism across multiple CPU cores
    const parallelBreeding = new ParallelBreeding(
      genus,
      this.config,
      this.workers,
    );
    const offspringBatch = await parallelBreeding.breedBatch(newPopSize);
    newPopulation.push(...offspringBatch);

    // Keep breed instance for DeDuplicator usage later
    const breed = new Breed(genus, this.config);

    // Issue #1039: Apply plateau stagnation response - increase mutation rate
    const mutationMultiplier = this.plateauDetector.getMutationMultiplier();
    let mutatorConfig = this.config;
    if (mutationMultiplier > 1.0) {
      // Create a modified config with increased mutation rate
      const adjustedMutationRate = Math.min(
        this.config.mutationRate * mutationMultiplier,
        1.0, // Cap at 100%
      );
      mutatorConfig = createNeatConfig({
        ...this.config,
        mutationRate: adjustedMutationRate,
      });
      if (this.config.verbose) {
        console.info(
          `[Plateau] Stagnation detected - mutation rate increased from ` +
            `${(this.config.mutationRate * 100).toFixed(1)}% to ` +
            `${(adjustedMutationRate * 100).toFixed(1)}% ` +
            `(${this.plateauDetector.getGenerationsOnPlateau()} generations on plateau)`,
        );
      }
    }

    const mutator = new Mutator(mutatorConfig);
    // Replace the old population with the new population
    mutator.mutate(newPopulation);

    // Issue #1099: Single-pass de-duplication - create DeDuplicator but defer perform()
    // until after all population sources are combined. This reduces overhead from
    // running de-duplication twice (after breeding and again after combining sources).
    // The previous two-pass approach (Issue #1014) caught duplicates early but
    // redundantly checked newPopulation creatures again in the final pass.
    const deDuplicator = new DeDuplicator(breed, mutator);

    const trainedPopulation: Creature[] = [];

    for (let i = this.trainingComplete.length; i--;) {
      const r = this.trainingComplete[i];
      assert(r.train, "No train found");
      assert(Number.isFinite(r.train.error), "No train error found");

      const json = JSON.parse(r.train.creature);
      if (this.config.verbose) {
        console.info(
          `Training ${blue(r.train.ID)} completed ${
            r.duration
              ? "after " + format(r.duration, { ignoreZero: true })
              : ""
          }`,
        );
      }

      addTag(json, "approach", "trained" as Approach);
      delete json.memetic;
      removeTag(json, "approach-logged");
      addTag(json, "trainID", r.train.ID);
      addTag(json, "trained", "YES");

      trainedPopulation.push(Creature.fromJSON(json, this.config.debug));
      if (r.train.backtracked) {
        fineTunedPopulation.push(
          Creature.fromJSON(JSON.parse(r.train.backtracked), this.config.debug),
        );
      }
      if (r.train.forward) {
        fineTunedPopulation.push(
          Creature.fromJSON(JSON.parse(r.train.forward), this.config.debug),
        );
      }
      const compactJSON = r.train.compact
        ? JSON.parse(r.train.compact)
        : undefined;

      if (compactJSON) {
        if (this.config.verbose) {
          console.info(
            `Training ${blue(r.train.ID)} compacted`,
          );
        }

        addTag(compactJSON, "approach", "compact" as Approach);
        delete compactJSON.memetic;
        removeTag(compactJSON, "approach-logged");
        addTag(compactJSON, "trainID", r.train.ID);
        addTag(compactJSON, "trained", "YES");

        trainedPopulation.push(
          Creature.fromJSON(compactJSON, this.config.debug),
        );
      }

      // Immediately clear large objects to help GC
      // @ts-ignore - clearing to help GC
      r.train.creature = null;
      // @ts-ignore - clearing to help GC
      r.train.trace = null;
      // @ts-ignore - clearing to help GC
      r.train.compact = null;
      // @ts-ignore - clearing to help GC
      r.train.backtracked = null;
      // @ts-ignore - clearing to help GC
      r.train.forward = null;
    }
    this.trainingComplete.length = 0;

    // Issue #1020: Process discovery results by adding discovered creatures directly.
    // The improved creature was already built from the original creature in scheduleDiscovery(),
    // so we just add it to the population without applying changes to the current fittest.
    // This ensures evolution continues without being blocked by discovery results.
    for (let i = this.discoveryComplete.length; i--;) {
      const r = this.discoveryComplete[i];
      assert(r.discover, "No discovery found");

      // Issue #1020: Add the pre-built improved creature directly to the population.
      // The creature was built in scheduleDiscovery() from the original creature,
      // not the current fittest. This allows discoveries to be applied without
      // blocking evolution or racing with population changes.
      if (r.discover.improvedCreature) {
        const discoveredCreature = Creature.fromJSON(
          r.discover.improvedCreature,
        );
        CreatureUtil.makeUUID(discoveredCreature);

        validateAfterDiscoveryOrThrow({
          baseCreature: fittest,
          discoveredCreature: discoveredCreature,
          discoveryID: r.discover.ID,
          operation: "discovered-creature-addition",
          feedbackLoop: this.config.feedbackLoop,
        });

        trainedPopulation.push(discoveredCreature);

        if (this.config.verbose) {
          console.info(
            `[Neat] Added discovered creature ${
              blue(discoveredCreature.uuid?.substring(0, 8) ?? "unknown")
            } to population (from discovery ${
              blue(
                r.discover.ID.substring(Math.max(0, r.discover.ID.length - 8)),
              )
            })`,
          );
        }
      }

      // Immediately clear large objects to help GC
      // @ts-ignore - clearing to help GC
      r.discover.addHelpfulSynapses = null;
      // @ts-ignore - clearing to help GC
      r.discover.removeHarmfulSynapse = null;
      // @ts-ignore - clearing to help GC
      r.discover.candidateSquashes = null;
      // @ts-ignore - clearing to help GC
      r.discover.improvedCreature = null;
    }
    this.discoveryComplete.length = 0;

    // Issue #997: Process completed background replay results and add improved
    // creatures to the population. These are creatures that have had cached
    // discovery improvements re-applied from previous evolution runs.
    // Issue #1150: Log detailed information about successful candidates
    const replayResults = this.discoveryReplayQueue.getCompletedResults();
    for (const result of replayResults) {
      // Issue #1150: Log replay summary showing which candidates were evaluated
      // and their outcomes. This provides visibility into the replay process
      // even when no improvement is found.
      this.logReplaySummary(result);

      if (result.improvement?.creature) {
        // The creature field is typed as `unknown` in DiscoveryReplayDirResult
        // but is actually a CreatureExport from exportJSON()
        const replayedCreature = Creature.fromJSON(
          result.improvement.creature as Parameters<
            typeof Creature.fromJSON
          >[0],
        );
        CreatureUtil.makeUUID(replayedCreature);

        // Tag the creature to indicate it came from discovery replay
        addTag(replayedCreature, "approach", "discovery-replay" as Approach);

        validateAfterDiscoveryOrThrow({
          baseCreature: fittest,
          discoveredCreature: replayedCreature,
          discoveryID: result.improvement.key ?? "replay",
          operation: "discovery-replay-addition",
          feedbackLoop: this.config.feedbackLoop,
        });

        trainedPopulation.push(replayedCreature);

        if (this.config.verbose) {
          console.info(
            `[Neat] Added replayed creature ${
              blue(replayedCreature.uuid?.substring(0, 8) ?? "unknown")
            } to population (score improvement: ${
              result.improvement.scoreDelta?.toFixed(4) ?? "N/A"
            })`,
          );
        }
      }
    }
    this.discoveryReplayQueue.clearCompletedResults();

    /** make sure we do at least one more loop */
    if (trainedPopulation.length > 0 && this.additionalGenerationCount <= 0) {
      this.additionalGenerationCount = 1;
    }

    this.population = [
      ...elitists,
      ...trainedPopulation,
      ...fineTunedPopulation,
      ...newPopulation,
      ...dnaPopulation,
    ]; // Keep pseudo sorted.

    // Issue #1099: Single-pass de-duplication on the combined population
    // This catches duplicates both within each source and between different
    // population sources (elitists, trainedPopulation, fineTunedPopulation,
    // newPopulation, dnaPopulation) in a single operation, reducing overhead
    // compared to the previous two-pass approach.
    deDuplicator.perform(this.population);

    return {
      fittest: fittest,
      averageScore: results.averageScore,
      // Issue #1039: Include plateau detection status in evolution results
      plateau: {
        onPlateau: this.plateauDetector.isOnPlateau(),
        generationsOnPlateau: this.plateauDetector.getGenerationsOnPlateau(),
        improvementRate: this.plateauDetector.getImprovementRate(),
        mutationMultiplier: this.plateauDetector.getMutationMultiplier(),
      },
    };
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

  /**
   * Create the initial pool of genomes
   */
  populatePopulation(creature: Creature) {
    if (this.config.debug) {
      creatureValidate(creature);
    }
    const mutator = new Mutator(this.config);
    while (this.population.length < this.config.populationSize - 1) {
      const clonedCreature = Creature.fromJSON(
        creature.exportJSON(),
        this.config.debug,
      );
      const creatures = [clonedCreature];
      mutator.mutate(creatures);
      this.population.push(creatures[0]);
    }

    this.population.unshift(creature);

    const genus = new Genus();

    // The population is already sorted in the desired order
    for (let i = 0; i < this.population.length; i++) {
      const creature = this.population[i];
      CreatureUtil.makeUUID(creature);
      genus.addCreature(creature);
    }

    const breed = new Breed(genus, this.config);
    const deDuplicator = new DeDuplicator(breed, mutator);
    deDuplicator.perform(this.population);
  }
}
