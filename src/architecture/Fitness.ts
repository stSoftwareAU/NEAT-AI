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
    if (!responseData.evaluate) throw "Invalid response";

    const error = responseData.evaluate.error;
    addTag(creature, "error", Math.abs(error).toString());

    const score = -error - (
          creature.nodes.length -
          creature.input -
          creature.output +
          creature.connections.length
        ) * this.growth;

    creature.score = Number.isFinite(score) ? score : -Infinity;
    addTag(creature, "score", creature.score.toString());
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
