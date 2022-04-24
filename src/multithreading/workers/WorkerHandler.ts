import { NetworkInterface } from "../../architecture/NetworkInterface.ts";
import { Network } from "../../architecture/network.js";

import { WorkerProcessor } from "./WorkerProcessor.ts";

export interface WorkerData {
  initialize?: {
    dataSetDir: string;
    costName: string;
  };
  evaluate?: {
    network: string;
  };
}

export class WorkerHandle {
  private worker: (Worker | null) = null;
  private mockProcessor: (WorkerProcessor | null) = null;

  constructor(
    dataSetDir: string,
    costName: string,
    direct: boolean = false,
  ) {
    if (typeof dataSetDir === "undefined") {
      throw "dataSet is mandatory";
    }
    const data: WorkerData = {
      initialize: {
        dataSetDir: dataSetDir,
        costName: costName,
      },
    };
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

      this.worker.postMessage(data);
    } else {
      this.mockProcessor = new WorkerProcessor();
      this.mockProcessor.process(data);
    }
  }

  terminate() {
    this.mockProcessor = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null; // release the memory.
    }
  }

  evaluate(network: NetworkInterface) {
    const data: WorkerData = {
      evaluate: {
        network: network.toJSON(),
      },
    };

    if (this.worker) {
      const _that = this.worker;
      return new Promise((resolve) => {
        _that.addEventListener("message", function callback(message) {
          _that.removeEventListener("message", callback);

          const error: number = message.data.error;
          resolve(error);
        });

        _that.postMessage(data);
      });
    } else if (this.mockProcessor) {
      const _that = this.mockProcessor;

      return new Promise((resolve) => {
        const result = _that.process(data);
        if ("error" in result) {
          resolve(result.error);
        } else {
          throw "No error property";
        }
      });
    } else {
      throw "No real or fake worker";
    }
  }
}
