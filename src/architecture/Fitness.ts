import { NetworkInternal } from "./NetworkInterfaces.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { addTag } from "../tags/TagsInterface.ts";

type PromiseFunction = (v: unknown) => void;

let calculationData: {
  queue: NetworkInternal[];
  resolve: PromiseFunction;
  reject: PromiseFunction;
  that: Fitness;
} | null = null;

export class Fitness {
  private workers: WorkerHandler[];
  private growth: number;
  private feedbackLoop: boolean;

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

  private async _callWorker(worker: WorkerHandler, creature: NetworkInternal) {
    const responseData = await worker.evaluate(creature, this.feedbackLoop);

    if (!responseData.evaluate) {
      throw new Error("Invalid response from worker.");
    }

    const error = responseData.evaluate.error;
    addTag(creature, "error", Math.abs(error).toString());

    // Calculate the max out-of-bounds value for weights and biases
    const maxOutOfBounds = this.calculateMaxOutOfBounds(creature);

    // Calculate the penalty using an Exponential function
    const penalty = this.calculatePenalty(maxOutOfBounds);

    // Calculate the score considering nodes, connections, and the penalty
    const score = this.calculateScore(error, creature, penalty);

    creature.score = Number.isFinite(score) ? score : -Infinity;
    addTag(creature, "score", creature.score.toString());
  }

  private calculateMaxOutOfBounds(creature: NetworkInternal): number {
    let maxOutOfBounds = 0;
    for (const conn of creature.connections) {
      const w = Math.abs(conn.weight) - 1;
      if (w > 0) {
        maxOutOfBounds = Math.max(maxOutOfBounds, w);
      }
    }
    for (const node of creature.nodes) {
      if (node.type != "input") {
        const b = node.bias ? Math.abs(node.bias) - 1 : 0;
        if (b > 0) {
          maxOutOfBounds = Math.max(maxOutOfBounds, b);
        }
      }
    }
    return maxOutOfBounds;
  }

  private calculatePenalty(maxOutOfBounds: number): number {
    // Calculate the primary penalty using the Exponential function.
    // This penalty will be in the range [0, this.growth].
    const primaryPenalty = (1 - Math.exp(-maxOutOfBounds)) * this.growth;

    // Initialize the multiplier to 1.
    // This will be used to increase the penalty if primaryPenalty is close to its maximum value.
    let multiplier = 1;

    // If the primaryPenalty is greater than 0.9 (choose an appropriate threshold),
    // apply an additional multiplier to penalize extremely large weights or biases.
    if (primaryPenalty > 0.9) {
      // Calculate the additional multiplier using a sigmoid function applied to the logarithm of maxOutOfBounds.
      // This will ensure that the multiplier is in the range (1, 2].
      multiplier += 1 / (1 + Math.exp(-Math.log(maxOutOfBounds + 1)));
    }

    // Calculate the final penalty as the product of the primary penalty and the multiplier.
    // This ensures that networks with extremely large weights or biases are penalized more heavily.
    const combinedPenalty = primaryPenalty * multiplier;

    return combinedPenalty;
  }

  private calculateScore(
    error: number,
    creature: NetworkInternal,
    penalty: number,
  ): number {
    return -error - (
          creature.nodes.length -
          creature.input -
          creature.output +
          creature.connections.length
        ) * this.growth -
      penalty;
  }

  private async schedule() {
    if (!calculationData) throw "No calculation data";

    const data = calculationData;

    const promises = [];
    for (let i = this.workers.length; i--;) {
      const w = this.workers[i];
      if (!w.isBusy()) {
        while (data.queue.length > 0) {
          const creature = data.queue.shift();
          if (creature && !creature.score) {
            promises.push(this._callWorker(w, creature));
            break;
          }
        }
      }
    }

    await Promise.all(promises);

    if (data.queue.length == 0) {
      data.resolve("");
    }
  }

  calculate(population: NetworkInternal[]) {
    return new Promise((resolve, reject) => {
      calculationData = {
        queue: population.slice(),
        resolve: resolve,
        reject: reject,
        that: this,
      };

      this.schedule();
    });
  }
}
