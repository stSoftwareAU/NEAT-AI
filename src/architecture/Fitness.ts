import { NetworkInternal } from "./NetworkInterfaces.ts";
import { Network } from "./Network.ts";
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

  constructor(workers: WorkerHandler[], growth: number) {
    this.workers = workers;
    workers.forEach((w) => w.addIdleListener(this._reschedule));
    this.growth = growth;
  }

  private _reschedule() {
    if (calculationData && calculationData.queue.length > 0) {
      calculationData.that.schedule();
    }
  }

  private async _callWorker(worker: WorkerHandler, creature: NetworkInternal) {
    const responseData = await worker.evaluate(creature);
    if (!responseData.evaluate) throw "Invalid response";

    const error = responseData.evaluate.error;
    addTag(creature, "error", Math.abs(error).toString());
    const realCreature = creature as Network;
    creature.score = -error - (
          creature.nodes.length -
          creature.input -
          creature.output +
          creature.connections.length +
          realCreature.gates().length
        ) * this.growth;

    creature.score = Number.isFinite(creature.score)
      ? creature.score
      : -Infinity;
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
