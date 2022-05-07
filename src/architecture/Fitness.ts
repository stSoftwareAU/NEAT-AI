import { NetworkInterface } from "./NetworkInterface.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { addTag } from "../tags/TagsInterface.ts";

type PromiseFunction = (v: unknown) => void;

let calculationData: ({
  queue: NetworkInterface[];
  resolve: PromiseFunction;
  reject: PromiseFunction;
  that: Fitness;
} | null) = null;

export class Fitness {
  private workers: WorkerHandler[];
  private growth: number;

  constructor(workers: WorkerHandler[], growth: number) {
    this.workers = workers;

    workers.forEach((w) => w.addIdleListener(this._callback));
    this.growth = growth;
  }

  private _callback() {
    calculationData?.that.schedule();
  }

  private async _callWorker(worker: WorkerHandler, creature: NetworkInterface) {
    const responeData = await worker.evaluate(creature);
    if (!responeData.evaluate) throw "Invalid response";

    const error = responeData.evaluate.error;
    addTag(creature, "error", (-error).toString());
    creature.score = -error - (
          creature.nodes.length -
          creature.input -
          creature.output +
          creature.connections.length +
          (creature.gates ? creature.gates.length : 0)
        ) * this.growth;

    creature.score = isFinite(creature.score) ? creature.score : -Infinity;
    addTag(creature, "score", creature.score.toString());
  }

  private schedule() {
    if (!calculationData) throw "No calculation data";
console.info( "schedule workers: ",  this.workers.length);
    const data = calculationData;

    const promises = [];
    for (let i = this.workers.length; i--;) {
      const w = this.workers[i];
      if (!w.isBusy()) {
        console.info( "indx", i,"Not busy, remaining creatures", data.queue.length);
        const creature = data.queue.shift();
        if (creature && !creature.score) {
          console.info( "indx", i,"Scheduling another creature");
          promises.push(this._callWorker(w, creature));
        }
        else{
          if( !creature){
          console.info( "indx", i,"Not scheduling a null creature");
          }
          else{
            console.info( "indx", i,"Not scheduling already scored creature");
          }
        }
      }
      else{
        console.info( "indx", i, "worker busy");
      }
    }

    Promise.all(promises).then(
      (r) => {
        console.info( "Promise.all");
        console.info( "data.queue.length", data.queue.length);
        if (data.queue.length == 0) {
          console.info( "resolve");
          data.resolve(r);
          // calculationData = null;
        }
      },
    ).catch((reason) => {console.error(reason);data.reject(reason);});
  }

  calculate(population: NetworkInterface[]) {
    return new Promise((resolve, reject) => {
      // Create a queue

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
