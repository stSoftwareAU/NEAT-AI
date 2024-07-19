import { addTag } from "@stsoftware/tags";
import type { Creature } from "../Creature.ts";
import type { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { calculate as calculateScore } from "./Score.ts";
import { assert } from "@std/assert";

type PromiseFunction = (v: unknown) => void;

let calculationData: {
  queue: Creature[];
  resolve: PromiseFunction;
  reject: PromiseFunction;
  that: Fitness;
} | null = null;

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
    addTag(creature, "error", Math.abs(error).toString());

    creature.score = calculateScore(creature, error, this.growth);

    addTag(creature, "score", creature.score.toString());
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

        assert(creature, "No creature");
        assert(creature.score === undefined, "Creature already has a score");
        promises.push(this._callWorker(w, creature));
      }
    }

    await Promise.any(promises);

    if (data.queue.length == 0) {
      if (this.calledWorkers == 0) {
        data.resolve("");
      }
    }
  }

  calculate(population: Creature[]) {
    return new Promise((resolve, reject) => {
      calculationData = {
        queue: population.filter((c) => c.score === undefined),
        resolve: resolve,
        reject: reject,
        that: this,
      };

      this.schedule();
    });
  }
}
