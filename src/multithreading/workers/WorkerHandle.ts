import { NetworkInterface } from "../../architecture/NetworkInterface.ts";
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

  constructor(
    dataSetDir: string,
    costName: string,
    direct: boolean = false,
  ) {
    if (typeof dataSetDir === "undefined") {
      throw "dataSet is mandatory";
    }

    if (!direct) {
      this.worker = new Worker(
        new URL("./deno/worker.js", import.meta.url).href,
        {
          type: "module",
          deno: {
            namespace: true,
            permissions: {
              read: [
                dataSetDir,
              ],
            },
          },
        },
      );

      this.worker.postMessage({
        dataSetDir: dataSetDir,
        costName: costName,
      });
    } else {
      this.mockWorker = {
        dataSetDir: dataSetDir,
        cost: this.findCost(costName),
      };
    }
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null; // release the memory.
    }
  }

  evaluate(network: NetworkInterface) {
    if (this.worker) {
      const _that = this.worker;
      return new Promise((resolve) => {
        const data = {
          network: network.toJSON(),
        };

        _that.addEventListener("message", function callback(message) {
          _that.removeEventListener("message", callback);

          const error: number = message.data.error;
          resolve(error);
        });

        _that.postMessage(data);
      });
    } else if (this.mockWorker) {
      const _that = this.mockWorker;

      return new Promise((resolve) => {
        const mockNetwork = Network.fromJSON(network.toJSON());
        const result = mockNetwork.test(_that.dataSetDir, _that.cost);

        resolve(result.error);
      });
    } else {
      throw "No real or fake worker";
    }
  }
}
