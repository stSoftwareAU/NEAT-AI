import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import type { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { calculate as calculateScore } from "./Score.ts";

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
 */
export class Fitness {
  private workers: WorkerHandler[];
  private growth: number;
  private feedbackLoop: boolean;

  constructor(workers: WorkerHandler[], growth: number, feedbackLoop: boolean) {
    this.workers = workers;
    this.feedbackLoop = feedbackLoop;
    this.growth = growth;
  }

  /**
   * Calculate fitness scores for a population of creatures.
   *
   * Issue #1016: Deduplicates creatures by UUID before evaluation.
   * Issue #1289: Distributes evaluations across the worker pool using a
   * work-stealing pattern for parallel execution.
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

    // Issue #1289: Work-stealing pattern - each worker continuously pulls
    // creatures from the shared queue until it is empty.
    // Issue #1481: Use index pointer instead of Array.shift() for O(1) dequeue.
    const queue = [...uniqueQueue];
    let front = 0;

    const processNext = async (worker: WorkerHandler): Promise<void> => {
      if (front >= queue.length) return;
      const creature = queue[front++];

      const responseData = await worker.evaluate(creature, this.feedbackLoop);
      if (!responseData.evaluate) {
        throw new Error("Invalid response from worker.");
      }

      const error = responseData.evaluate.error;
      delete responseData.evaluate;
      addTag(creature, "error", error.toString());

      creature.score = calculateScore(creature, error, this.growth);
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

    // Start all workers processing the queue concurrently
    await Promise.all(this.workers.map((worker) => processNext(worker)));
  }
}
