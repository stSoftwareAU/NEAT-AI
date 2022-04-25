import { NetworkInterface } from "./NetworkInterface.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { addTag } from "../tags/TagsInterface.ts";

export class Fitness {
  private workers: WorkerHandler[];
  private growth: number;

  constructor(workers: WorkerHandler[], growth: number) {
    this.workers = workers;
    this.growth = growth;
  }

  calculate(population: NetworkInterface[]) {
    const growth = this.growth;
    const workers = this.workers;
    return new Promise((resolve, reject) => {
      // Create a queue
      const queue = population.slice();

      // Start worker function
      const startWorker = async function (worker: WorkerHandler) {
        while (queue.length) {
          const creature = queue.shift();
          if (!creature) continue;
          if (creature.score) {
            // console.log("creatue already have been scored",creature.score);
            continue;
          }
          // const creatureID=population.length - queue.length;
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
              ) * growth;

          creature.score = isFinite(creature.score)
            ? creature.score
            : -Infinity;
          addTag(creature, "score", creature.score.toString());
          // console.info( "Creature", creatureID, "result", result, "score", creature.score);
        }
      };
      const promises = new Array(workers.length);
      for (let i = workers.length; i--;) {
        promises[i] = startWorker(workers[i]);
      }

      Promise.all(promises).then((r) => resolve(r)).catch((reason) =>
        reject(reason)
      );
    });
  }
}
