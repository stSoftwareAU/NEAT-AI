import { Network } from "../../architecture/network.js";
import { Cost } from "../../methods/cost.js";

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
      this.worker=null; // release the memory.
    }
  }

  evaluate(network: Network) {
    if (this.worker) {
      const _that = this.worker;
      return new Promise((resolve) => {
        const data = {
          network: network.toJSON(),
        };

        _that.addEventListener("message", function callback(message) {
          _that.removeEventListener("message", callback);

          resolve(message.data.error);
        });

        _that.postMessage(data);
      });
    } else if (this.mockWorker) {
      const _that = this.mockWorker;

      const mockNetwork = Network.fromJSON(network.toJSON());
      const result = mockNetwork.test(_that.dataSet, _that.cost);

      return new Promise((resolve) => {
        resolve(result.error);
      });
    } else {
      throw "No real or fake worker";
    }
  }
}
