import { Network } from "../../architecture/network.js";
import { Cost } from "../../methods/cost.js";
import { Multi } from "../../multithreading/multi.js";

export class WorkerHandle {
  private worker: (Worker | null) = null;
  private mockWorker;

  private findCost(costName: string) {
    const values = Object.values(Cost);
    for (let i = values.length; i--;) {
      const v = values[i];

      if (v.name == costName) {
        return v;
      }
    }
  }
  constructor(dataSet: any, costName: string, direct: boolean = false) {
    if (typeof dataSet === "undefined") {
      throw "dataSet is mandatory";
    }

    if (!direct) {
      this.worker = new Worker(
        new URL("./deno/worker.js", import.meta.url).href,
        {
          type: "module",
        },
      );

      this.worker.postMessage({ dataSet: dataSet, costName: costName });
    } else {
      this.mockWorker = { dataSet: dataSet, cost: this.findCost(costName) };
    }
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
    }
  }

  evaluate(network: Network) {
    if (this.worker) {
      const _that = this.worker;
      return new Promise((resolve) => {
        const serialized = network.serialize();

        const data = {
          activations: serialized[0],
          states: serialized[1],
          conns: serialized[2],
        };

        _that.addEventListener("message", function callback(message) {
          _that.removeEventListener("message", callback);

          resolve(message.data);
        });

        _that.postMessage(data);
      });
    } else if (this.mockWorker) {
      const _that = this.mockWorker;

      const serialized = network.serialize();

      const data = {
        activations: serialized[0],
        states: serialized[1],
        conns: serialized[2],
      };

      const result = Multi.testSerializedSet(
        _that.dataSet,
        _that.cost,
        data.activations,
        data.states,
        data.conns,
      );
      return new Promise((resolve) => {
        resolve(result);
      });
    } else {
      throw "Not real of fake worker";
    }
  }
}
