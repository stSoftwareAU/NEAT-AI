import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import {
  DEFAULT_PARALLEL_EVALUATION_CONFIG,
  type RequiredParallelEvaluationConfig,
} from "@config/ParallelEvaluationConfig.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Evaluates fitness scores for a population of creatures.
 *
 * Issue #1289: Uses a parallel work-stealing pattern to distribute creature
 * evaluations across all available workers simultaneously. Each worker
 * consumes creatures from a shared queue, ensuring optimal load balancing
 * without the overhead of reactive idle-listener scheduling.
 *
 * Issue #1016: Deduplicates creatures by UUID before evaluation. Creatures
 * with identical UUIDs are evaluated once and the score is copied to all
 * duplicates.
 *
 * Issue #1862: Supports topology-aware grouping and configurable concurrency.
 * When topology grouping is enabled, creatures with identical network structure
 * are adjacent in the evaluation queue, maximising WASM compilation cache hits.
 * The maxConcurrentEvaluations setting caps how many workers participate.
 */
export class Fitness {
  private workers: WorkerHandler[];
  private growth: number;
  private feedbackLoop: boolean;
  private evalConfig: RequiredParallelEvaluationConfig;

  constructor(
    workers: WorkerHandler[],
    growth: number,
    feedbackLoop: boolean,
    evalConfig?: RequiredParallelEvaluationConfig,
  ) {
    this.workers = workers;
    this.feedbackLoop = feedbackLoop;
    this.growth = growth;
    this.evalConfig = evalConfig ?? DEFAULT_PARALLEL_EVALUATION_CONFIG;
  }

  /**
   * Calculate fitness scores for a population of creatures.
   *
   * Issue #1016: Deduplicates creatures by UUID before evaluation.
   * Issue #1289: Distributes evaluations across the worker pool using a
   * work-stealing pattern for parallel execution.
   * Issue #1862: Optionally groups creatures by topology hash for better
   * WASM cache utilisation, and caps concurrent evaluations.
   *
   * @param population - Array of creatures to evaluate
   * @returns Promise that resolves when all evaluations are complete
   */
  async calculate(population: Creature[]): Promise<void> {
    // Filter creatures that need evaluation (score is undefined)
    const needsEvaluation = population.filter((c) => c.score === undefined);

    // Issue #1016: Deduplicate by UUID to avoid redundant evaluations
    const duplicates = new Map<string, Creature[]>();
    const uniqueQueue: Creature[] = [];

    for (const creature of needsEvaluation) {
      const uuid = CreatureUtil.makeUUID(creature);

      if (!duplicates.has(uuid)) {
        duplicates.set(uuid, [creature]);
        uniqueQueue.push(creature);
      } else {
        duplicates.get(uuid)!.push(creature);
      }
    }

    if (uniqueQueue.length === 0) {
      return;
    }

    // Issue #1862: Sort by topology hash to cluster same-topology creatures.
    // This improves WASM compilation cache hit rates because workers pull
    // from the front of the queue, so same-topology creatures flow to the
    // same worker via the work-stealing pattern.
    // Issue #2123: Avoid unnecessary array copy. When grouping is disabled,
    // use uniqueQueue directly. When enabled, pre-compute hashes into a Map
    // for O(1) lookups during sort instead of O(n log n) hash computations.
    const queue: Creature[] = uniqueQueue;
    if (this.evalConfig.topologyGrouping) {
      const hashCache = new Map<Creature, string>();
      for (const creature of queue) {
        hashCache.set(creature, CreatureUtil.getTopologyHash(creature));
      }
      queue.sort((a, b) => {
        return hashCache.get(a)!.localeCompare(hashCache.get(b)!);
      });
    }

    // Issue #1289: Work-stealing pattern - each worker continuously pulls
    // creatures from the shared queue until it is empty.
    // Issue #1481: Use index pointer instead of Array.shift() for O(1) dequeue.
    let front = 0;

    // Issue #1862: Cap the number of concurrent workers if configured.
    const maxConcurrent = this.evalConfig.maxConcurrentEvaluations;
    const cappedWorkers = maxConcurrent > 0
      ? this.workers.slice(0, maxConcurrent)
      : this.workers;

    // Issue #2162: Exclude workers running long tasks (discovery/training)
    // so that Promise.all does not stall waiting for them.
    const availableWorkers = cappedWorkers.filter(
      (w) => !w.isRunningLongTask(),
    );

    // Guard: if ALL workers are busy, fall back to using all of them
    // to avoid deadlock — at least one worker must evaluate.
    const activeWorkers = availableWorkers.length > 0
      ? availableWorkers
      : cappedWorkers;

    if (availableWorkers.length < cappedWorkers.length) {
      const excluded = cappedWorkers.length - activeWorkers.length;
      if (excluded > 0) {
        getLogger().debug(
          `Fitness: excluded ${excluded} worker(s) running long tasks`,
        );
      } else {
        getLogger().debug(
          "Fitness: all workers running long tasks, using all as fallback",
        );
      }
    }

    const processNext = async (worker: WorkerHandler): Promise<void> => {
      if (front >= queue.length) return;
      const creature = queue[front++];

      const responseData = await worker.evaluate(creature, this.feedbackLoop);
      if (!responseData.evaluate) {
        throw new ValidationError("Invalid response from worker.", "OTHER");
      }

      const error = responseData.evaluate.error;
      delete responseData.evaluate;

      // Issue #2211: When a worker encounters a WASM panic (RuntimeError:
      // unreachable), it returns POSITIVE_INFINITY as the error value.
      // Rather than crashing the entire evolution with an assertion failure
      // in Score.calculate(), assign the worst possible score so natural
      // selection removes the creature gracefully.
      if (!Number.isFinite(error) || error < 0) {
        if (responseData.error) {
          getLogger().warn(
            `Worker error for creature ${creature.uuid ?? "unknown"}: ` +
              `${responseData.error.name}: ${responseData.error.message}`,
          );
        }
        addTag(creature, "error", "Infinity");
        creature.score = -Infinity;
      } else {
        addTag(creature, "error", error.toString());
        creature.score = calculateScore(creature, error, this.growth);
      }
      addTag(creature, "score", creature.score.toString());

      // Issue #1016: Copy score and tags to duplicate creatures
      const uuid = creature.uuid;
      if (uuid) {
        const dupes = duplicates.get(uuid);
        if (dupes) {
          const errorTag = getTag(creature, "error");
          const scoreTag = getTag(creature, "score");
          for (const duplicate of dupes) {
            if (duplicate !== creature) {
              duplicate.score = creature.score;
              if (errorTag) {
                addTag(duplicate, "error", errorTag);
              }
              if (scoreTag) {
                addTag(duplicate, "score", scoreTag);
              }
            }
          }
        }
      }

      // Recursively process next creature from the queue
      await processNext(worker);
    };

    // Start all active workers processing the queue concurrently
    await Promise.all(activeWorkers.map((worker) => processNext(worker)));
  }
}
