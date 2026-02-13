import { Creature, type NeatOptions } from "../../mod.ts";
import { Offspring } from "../architecture/Offspring.ts";
import { discover } from "../blackbox/Discover.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import type { Genus } from "../NEAT/Genus.ts";
import { FitnessRanking } from "./FitnessRanking.ts";
import { findFather, selectParent } from "./ParentSelection.ts";
import { getLogger } from "../utils/Logger.ts";

/**
 * Represents a parent pair for breeding.
 */
interface ParentPair {
  mother: Creature;
  father: Creature;
}

/**
 * Handles parallel breeding operations for NEAT populations.
 *
 * This class parallelises the breeding process by:
 * 1. Selecting parent pairs from the population (main thread)
 * 2. Creating offspring in parallel using the worker pool (if provided)
 *    or using Promise.all with queueMicrotask (fallback)
 *
 * Issue #1026: Parallelise breeding loop using worker pool.
 *
 * Key features:
 * - Pre-selects all parent pairs before breeding
 * - Distributes offspring creation across worker threads for true parallelism
 * - Falls back to main thread when workers are unavailable
 * - Handles breeding failures gracefully
 * - Maintains population diversity
 *
 * @example
 * ```ts
 * // With workers (true parallelism)
 * const parallelBreeding = new ParallelBreeding(genus, config, workers);
 * const offspring = await parallelBreeding.breedBatch(50);
 *
 * // Without workers (main thread fallback)
 * const parallelBreeding = new ParallelBreeding(genus, config);
 * const offspring = await parallelBreeding.breedBatch(50);
 * ```
 */
export class ParallelBreeding {
  /** The genus containing the population to breed from */
  readonly genus: Genus;
  /** Configuration options for breeding operations */
  readonly options: NeatOptions;
  /** Optional worker pool for true parallel breeding */
  private readonly workers?: WorkerHandler[];

  /**
   * Creates a new ParallelBreeding instance.
   *
   * @param genus - The genus containing the population
   * @param config - NEAT configuration options
   * @param workers - Optional worker pool for parallel breeding
   */
  constructor(genus: Genus, config: NeatConfig, workers?: WorkerHandler[]) {
    this.genus = genus;
    this.options = { ...config };
    this.workers = workers;
  }

  /**
   * Breeds a batch of offspring in parallel.
   *
   * This method:
   * 1. Pre-selects all parent pairs using FitnessRanking
   * 2. Creates offspring in parallel using workers (if available) or main thread
   * 3. Filters out failed breeding attempts
   *
   * @param count - Number of offspring to attempt to breed
   * @returns Array of valid offspring creatures
   */
  async breedBatch(count: number): Promise<Creature[]> {
    if (count <= 0) {
      return [];
    }

    const config = createNeatConfig(this.options);

    // Pre-compute fitness ranking once for the entire batch
    const populationRanking = new FitnessRanking(this.genus.population);

    // Step 1: Select all parent pairs (main thread, fast)
    const parentPairs: ParentPair[] = [];
    for (let i = 0; i < count; i++) {
      const pair = this.selectParentPair(populationRanking, config);
      if (pair) {
        parentPairs.push(pair);
      }
    }

    // Step 2: Create offspring in parallel
    let results: (Creature | undefined)[];

    if (this.workers && this.workers.length > 0) {
      // Use worker pool for true parallelism
      results = await this.breedWithWorkers(parentPairs, config);
    } else {
      // Fallback to main thread with microtask scheduling
      const breedingPromises = parentPairs.map((pair) =>
        this.breedSingle(pair.mother, pair.father, config)
      );
      results = await Promise.all(breedingPromises);
    }

    // Step 3: Filter out failed breeding attempts (undefined results)
    const offspring: Creature[] = [];
    for (const child of results) {
      if (child) {
        offspring.push(child);
      }
    }

    return offspring;
  }

  /**
   * Breeds offspring using the worker pool.
   *
   * Distributes breeding tasks across available workers using a work-stealing
   * pattern for optimal load balancing.
   *
   * @param parentPairs - Array of parent pairs to breed
   * @param config - NEAT configuration
   * @returns Array of offspring creatures (undefined for failures)
   */
  private async breedWithWorkers(
    parentPairs: ParentPair[],
    config: NeatConfig,
  ): Promise<(Creature | undefined)[]> {
    const workers = this.workers!;
    const queue = [...parentPairs];
    const results: (Creature | undefined)[] = new Array(parentPairs.length);
    let resultIndex = 0;

    // Work-stealing pattern: each worker processes tasks from the queue
    const processNext = async (
      worker: WorkerHandler,
    ): Promise<void> => {
      const pair = queue.shift();
      if (!pair) return;

      const currentIndex = resultIndex++;

      try {
        const response = await worker.breed(
          pair.mother,
          pair.father,
          config.geneticCompatibilityThreshold,
          config.feedbackLoop !== true, // forwardOnly
        );

        if (response.breed?.success && response.breed.offspring) {
          const child = Creature.fromJSON(JSON.parse(response.breed.offspring));

          // Apply memetic discovery on the main thread
          if (child && !child.memetic) {
            discover(pair.mother, child);
          }

          results[currentIndex] = child;
        } else {
          results[currentIndex] = undefined;
        }
      } catch (error) {
        getLogger().warn(
          `[ParallelBreeding] Worker breeding failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        results[currentIndex] = undefined;
      }

      // Process next task if available
      await processNext(worker);
    };

    // Start all workers processing the queue
    await Promise.all(workers.map((worker) => processNext(worker)));

    return results;
  }

  /**
   * Selects a parent pair for breeding.
   *
   * @param populationRanking - Pre-computed fitness ranking
   * @param config - NEAT configuration
   * @returns A parent pair, or undefined if selection fails
   */
  private selectParentPair(
    populationRanking: FitnessRanking,
    config: NeatConfig,
  ): ParentPair | undefined {
    const mum = selectParent(populationRanking, config);
    if (!mum) {
      return undefined;
    }

    const dad = findFather(mum, this.genus, config);
    if (!dad) {
      return undefined;
    }

    return { mother: mum, father: dad };
  }

  /**
   * Breeds a single offspring from two parents (main thread fallback).
   *
   * This method wraps `Offspring.breed()` in a Promise to enable
   * concurrent execution. It also:
   * - Calls discover() to apply memetic knowledge from the mother
   *
   * @param mother - The mother creature
   * @param father - The father creature
   * @param config - NEAT configuration
   * @returns The offspring creature, or undefined if breeding fails
   */
  private breedSingle(
    mother: Creature,
    father: Creature,
    config: NeatConfig,
  ): Promise<Creature | undefined> {
    // Use queueMicrotask to yield to the event loop
    return new Promise((resolve) => {
      queueMicrotask(() => {
        try {
          const child = Offspring.breed(
            mother,
            father,
            {
              geneticCompatibilityThreshold:
                config.geneticCompatibilityThreshold,
              forwardOnly: config.feedbackLoop !== true,
            },
          );

          if (child && !child.memetic) {
            discover(mother, child);
          }

          resolve(child);
        } catch (error) {
          getLogger().warn(
            `[ParallelBreeding] Breeding failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          resolve(undefined);
        }
      });
    });
  }
}
