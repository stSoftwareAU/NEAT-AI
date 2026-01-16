import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import type { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { calculate as calculateScore } from "./Score.ts";

type PromiseFunction = (v: unknown) => void;

/**
 * Data structure for tracking calculation state across async operations.
 * Issue #1016: Added duplicates map for evaluation deduplication.
 */
interface CalculationData {
  /** Queue of unique creatures to be evaluated */
  queue: Creature[];
  /** Promise resolver function */
  resolve: PromiseFunction;
  /** Promise reject function */
  reject: PromiseFunction;
  /** Reference to the Fitness instance */
  that: Fitness;
  /**
   * Map from UUID to arrays of creatures with that UUID.
   * Issue #1016: Enables copying scores from evaluated creature to duplicates.
   */
  duplicates: Map<string, Creature[]>;
}

let calculationData: CalculationData | null = null;

export class Fitness {
  private workers: WorkerHandler[];
  private growth: number;
  private feedbackLoop: boolean;

  private calledWorkers = 0;
  constructor(workers: WorkerHandler[], growth: number, feedbackLoop: boolean) {
    this.workers = workers;
    this.feedbackLoop = feedbackLoop;
    workers.forEach((w) => w.addIdleListener(this._reschedule));
    this.growth = growth;
  }

  private _reschedule() {
    if (calculationData && calculationData.queue.length > 0) {
      calculationData.that.schedule();
    }
  }

  private async _callWorker(worker: WorkerHandler, creature: Creature) {
    this.calledWorkers++;
    const responseData = await worker.evaluate(creature, this.feedbackLoop);
    this.calledWorkers--;
    if (!responseData.evaluate) {
      throw new Error("Invalid response from worker.");
    }

    const error = responseData.evaluate.error;
    delete responseData.evaluate;
    addTag(creature, "error", error.toString());

    creature.score = calculateScore(creature, error, this.growth);

    addTag(creature, "score", creature.score.toString());

    // Issue #1016: Copy score and tags to duplicate creatures
    if (calculationData) {
      const uuid = creature.uuid;
      if (uuid) {
        const duplicates = calculationData.duplicates.get(uuid);
        if (duplicates) {
          const errorTag = getTag(creature, "error");
          const scoreTag = getTag(creature, "score");
          for (const duplicate of duplicates) {
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
    }
  }

  private async schedule() {
    if (!calculationData) throw new Error("No calculation data");

    const data = calculationData;

    const promises = [];
    for (let i = this.workers.length; i--;) {
      const w = this.workers[i];

      if (!w.isBusy()) {
        const creature = data.queue.shift();
        if (!creature) break;

        promises.push(this._callWorker(w, creature));
      }
    }

    if (promises.length) {
      await Promise.all(promises);
    }

    if (data.queue.length === 0) {
      if (this.calledWorkers === 0) {
        data.resolve("");
      }
    }
  }

  /**
   * Calculate fitness scores for a population of creatures.
   *
   * Issue #1016: Now deduplicates creatures by UUID before evaluation.
   * Creatures with identical UUIDs (same structure and weights) will only
   * be evaluated once, and the score will be copied to all duplicates.
   *
   * @param population - Array of creatures to evaluate
   * @returns Promise that resolves when all evaluations are complete
   */
  calculate(population: Creature[]) {
    return new Promise((resolve, reject) => {
      // Filter creatures that need evaluation (score is undefined)
      const needsEvaluation = population.filter((c) => c.score === undefined);

      // Issue #1016: Deduplicate by UUID to avoid redundant evaluations
      const duplicates = new Map<string, Creature[]>();
      const uniqueQueue: Creature[] = [];

      for (const creature of needsEvaluation) {
        // Ensure creature has a UUID for deduplication
        const uuid = CreatureUtil.makeUUID(creature);

        if (!duplicates.has(uuid)) {
          // First time seeing this UUID - add to unique queue
          duplicates.set(uuid, [creature]);
          uniqueQueue.push(creature);
        } else {
          // Duplicate UUID - just add to duplicates map
          duplicates.get(uuid)!.push(creature);
        }
      }

      calculationData = {
        queue: uniqueQueue,
        resolve: resolve,
        reject: reject,
        that: this,
        duplicates: duplicates,
      };

      this.schedule();
    });
  }
}
