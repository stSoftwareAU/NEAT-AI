import { Creature } from "../../mod.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { discover } from "@blackbox/Discover.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import type { BreedingSubPhaseTiming } from "@config/TrainingEvent.ts";
import { BreedExhaustionError } from "@errors/BreedExhaustionError.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { Genus } from "@neat/Genus.ts";
import { BreedingSubPhaseAccumulator } from "@breed/BreedingSubPhaseAccumulator.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import {
  type BreedSelectionStats,
  buildAdjustedFitnessMap,
  findFather,
  selectParent,
} from "@breed/ParentSelection.ts";
import { getLogger } from "@utils/Logger.ts";

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
 * Issue #1538: Cache NeatConfig per generation instead of re-creating per batch.
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

  /**
   * Cached NeatConfig used directly without re-parsing (Issue #1538).
   */
  private readonly config: NeatConfig;

  /** Optional worker pool for true parallel breeding */
  private readonly workers?: WorkerHandler[];

  /**
   * Issue #2284: Sub-phase timing from the most recent `breedBatch()` call.
   * Only populated for non-worker breeding (main thread path).
   */
  lastBreedingSubPhases?: BreedingSubPhaseTiming;

  /**
   * Peak pending parent-pair depth observed during the most recent
   * `breedBatch()` call.
   *
   * Issue #2330: Captured immediately after parent-pair selection — the
   * point at which the breeding queue has its maximum depth — so throughput
   * diagnostics can report how deep the fast-pool breeding backlog became
   * without inserting Date.now() calls in the per-pair worker loop.
   */
  lastQueueMaxDepth = 0;

  /**
   * Issue #2523: Number of corrupt parent candidates skipped during the
   * most recent `breedBatch()` call. Surfaced in the per-batch
   * throughput summary so operators can alert on producer corruption.
   */
  lastCorruptParentSkips = 0;

  /**
   * Creates a new ParallelBreeding instance.
   *
   * @param genus - The genus containing the population
   * @param config - NEAT configuration (used directly, no re-parsing)
   * @param workers - Optional worker pool for parallel breeding
   */
  constructor(genus: Genus, config: NeatConfig, workers?: WorkerHandler[]) {
    this.genus = genus;
    this.config = config;
    this.workers = workers;
  }

  /**
   * Breeds a batch of offspring in parallel.
   *
   * This method:
   * 1. Pre-selects all parent pairs using a single FitnessRanking (Issue #1538)
   * 2. Creates offspring in parallel using workers (if available) or main thread
   * 3. Filters out failed breeding attempts
   *
   * @param count - Number of offspring to attempt to breed
   * @param speciesQuotas - Optional Issue #2453 quota map. When provided,
   *   mothers are drawn from each species in proportion to its quota
   *   (using a per-species FitnessRanking) instead of from a single global
   *   ranking. The total of `speciesQuotas.values()` should equal `count`.
   * @returns Array of valid offspring creatures
   */
  async breedBatch(
    count: number,
    speciesQuotas?: ReadonlyMap<string, number>,
  ): Promise<Creature[]> {
    if (count <= 0) {
      this.lastBreedingSubPhases = undefined;
      this.lastQueueMaxDepth = 0;
      this.lastCorruptParentSkips = 0;
      return [];
    }

    const config = this.config;
    // Issue #2523: Per-batch accumulator for corrupt-parent skips.
    const stats: BreedSelectionStats = { corruptParentSkips: 0 };

    // Issue #2284: Create sub-phase accumulator for timing instrumentation
    const acc = new BreedingSubPhaseAccumulator();

    // Issue #2453: When fitness sharing is enabled, rank the global
    // population by adjusted fitness so any global selection picks
    // creatures with cross-species fairness baked in.
    const adjustedScores = config.fitnessSharing.enabled
      ? buildAdjustedFitnessMap(this.genus)
      : undefined;

    // Pre-compute fitness ranking once for the entire batch
    const populationRanking = new FitnessRanking(
      this.genus.population,
      adjustedScores,
    );

    // Issue #2284: Time parent selection sub-phase
    const selectionStartMs = Date.now();

    // Step 1: Select all parent pairs (main thread, fast)
    const parentPairs: ParentPair[] = this.selectParentPairs(
      populationRanking,
      config,
      count,
      speciesQuotas,
      stats,
    );
    acc.parentSelectionMs = Date.now() - selectionStartMs;
    this.lastCorruptParentSkips = stats.corruptParentSkips;
    if (stats.corruptParentSkips > 0) {
      getLogger().warn(
        `[ParallelBreeding] corruptParentSkips=${stats.corruptParentSkips} count=${count}`,
      );
    }

    // Issue #2330: Parent pairs are enqueued in one go before workers start
    // pulling, so the peak breeding backlog is `parentPairs.length`.
    this.lastQueueMaxDepth = parentPairs.length;

    // Step 2: Create offspring in parallel
    let results: (Creature | undefined)[];

    if (this.workers && this.workers.length > 0) {
      // Use worker pool for true parallelism
      // Issue #2324: Workers now capture sub-phase timing and return it
      // in the response. The main thread aggregates these into the accumulator.
      results = await this.breedWithWorkers(parentPairs, config, acc);
    } else {
      // Fallback to main thread with microtask scheduling
      const breedingPromises = parentPairs.map((pair) =>
        this.breedSingle(pair.mother, pair.father, config, acc)
      );
      results = await Promise.all(breedingPromises);
    }

    // Issue #2284: Freeze accumulated timing
    this.lastBreedingSubPhases = acc.toTiming();

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
   * pattern with iterative loops for optimal load balancing.
   *
   * Issue #1585: Replaced recursive processNext with while loop to avoid
   * stack overflow and reduce memory usage for large populations.
   * Issue #2324: Accepts an accumulator to aggregate sub-phase timing
   * returned from worker breeding responses.
   *
   * @param parentPairs - Array of parent pairs to breed
   * @param config - NEAT configuration
   * @param acc - Accumulator for aggregating worker sub-phase timing
   * @returns Array of offspring creatures (undefined for failures)
   */
  private async breedWithWorkers(
    parentPairs: ParentPair[],
    config: NeatConfig,
    acc: BreedingSubPhaseAccumulator,
  ): Promise<(Creature | undefined)[]> {
    const workers = this.workers!;
    const queue = [...parentPairs];
    const results: (Creature | undefined)[] = new Array(parentPairs.length);
    let resultIndex = 0;

    // Issue #2279: Use index pointer instead of Array.shift() for O(1) dequeue.
    // Array.shift() is O(n) per removal (re-indexes all remaining elements),
    // making the work-stealing loop O(n²). An index pointer is O(1) per dequeue.
    let queueFront = 0;

    // Work-stealing pattern: each worker iteratively processes tasks from the queue
    const processQueue = async (
      worker: WorkerHandler,
    ): Promise<void> => {
      while (queueFront < queue.length) {
        const pair = queue[queueFront++];
        if (!pair) break;

        const currentIndex = resultIndex++;

        try {
          // Each worker must await sequentially to implement work-stealing:
          // a worker finishes one task before grabbing the next from the queue.
          // deno-lint-ignore no-await-in-loop
          const response = await worker.breed(
            pair.mother,
            pair.father,
            config.geneticCompatibilityThreshold,
            config.feedbackLoop !== true, // forwardOnly
          );

          if (response.breed?.success && response.breed.offspring) {
            const child = Creature.fromJSON(
              response.breed.offspring,
            );

            // Apply memetic discovery on the main thread
            if (child && !child.memetic) {
              discover(pair.mother, child);
            }

            // Issue #2324: Aggregate sub-phase timing from worker response
            if (response.breed.subPhaseTiming) {
              const t = response.breed.subPhaseTiming;
              acc.geneticCompatibilityMs += t.geneticCompatibilityMs;
              acc.alignmentCrossoverMs += t.alignmentCrossoverMs;
              acc.sortNeuronsMs += t.sortNeuronsMs;
              acc.batchConnectionMs += t.batchConnectionMs;
              acc.postBreedingRepairMs += t.postBreedingRepairMs;
              acc.offspringCount += t.offspringCount;
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
      }
    };

    // Start all workers processing the queue
    await Promise.all(workers.map((worker) => processQueue(worker)));

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
    stats?: BreedSelectionStats,
  ): ParentPair | undefined {
    const mum = selectParent(populationRanking, config);
    if (!mum) {
      return undefined;
    }

    let dad: Creature | undefined;
    try {
      dad = findFather(mum, this.genus, config, stats);
    } catch (error) {
      // Issue #2523: BreedExhaustionError is recoverable — skip this
      // mother and let the batch continue. Anything else propagates.
      if (error instanceof BreedExhaustionError) {
        return undefined;
      }
      throw error;
    }
    if (!dad) {
      return undefined;
    }

    return { mother: mum, father: dad };
  }

  /**
   * Issue #2453: Build the parent-pair list for the batch. When
   * `speciesQuotas` is provided, mothers are drawn from each species in
   * proportion to its quota using a per-species FitnessRanking; this is
   * the fitness-sharing path. Otherwise the legacy global path runs.
   *
   * @param populationRanking - Pre-computed global ranking (used by legacy
   *   path and as a fallback when a quota-target species is missing).
   * @param config - NEAT configuration
   * @param count - Total mothers requested
   * @param speciesQuotas - Optional per-species quota map
   * @returns Selected parent pairs (failed selections are silently skipped)
   */
  private selectParentPairs(
    populationRanking: FitnessRanking,
    config: NeatConfig,
    count: number,
    speciesQuotas?: ReadonlyMap<string, number>,
    stats?: BreedSelectionStats,
  ): ParentPair[] {
    const parentPairs: ParentPair[] = [];

    if (!speciesQuotas || speciesQuotas.size === 0) {
      for (let i = 0; i < count; i++) {
        const pair = this.selectParentPair(populationRanking, config, stats);
        if (pair) parentPairs.push(pair);
      }
      return parentPairs;
    }

    // Per-species path: build one FitnessRanking per species so mothers
    // are drawn from that species using the configured selection method.
    // Within a species, every member's adjusted score is scaled by the
    // same denominator (speciesSize), so the legacy raw-score ranking is
    // already proportional to adjusted fitness.
    let allocated = 0;
    for (const [speciesKey, quota] of speciesQuotas) {
      if (quota <= 0) continue;
      allocated += quota;
      const species = this.genus.speciesMap.get(speciesKey);
      if (!species || species.creatures.length === 0) continue;
      const speciesRanking = new FitnessRanking(species.creatures);
      for (let i = 0; i < quota; i++) {
        const mum = selectParent(speciesRanking, config);
        if (!mum) continue;
        let dad: Creature | undefined;
        try {
          dad = findFather(mum, this.genus, config, stats);
        } catch (error) {
          if (error instanceof BreedExhaustionError) {
            continue;
          }
          throw error;
        }
        if (!dad) continue;
        parentPairs.push({ mother: mum, father: dad });
      }
    }

    // Top up using the global ranking if quotas under-allocated due to
    // rounding or empty species (defence in depth — quotas should sum
    // to count, but never exceed the requested batch).
    for (let i = allocated; i < count; i++) {
      const pair = this.selectParentPair(populationRanking, config, stats);
      if (pair) parentPairs.push(pair);
    }

    return parentPairs;
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
    acc?: BreedingSubPhaseAccumulator,
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
              hyperparameterEvolution: config.hyperparameterEvolution,
              subPhaseAccumulator: acc,
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
