import { NetworkInterface } from "../../architecture/NetworkInterface.ts";

import { WorkerProcessor } from "./WorkerProcessor.ts";

export interface RequestData {
  taskID: number;
  initialize?: {
    dataSetDir: string;
    costName: string;
  };
  evaluate?: {
    network: string;
  };
  train?: {
    network: string;
  };
}

export interface ResponseData {
  taskID: number;
  duration: number;
  initialize?: {
    status: string;
  };
  evaluate?: {
    error: number;
  };
  train?: {
    network: string;
    error: number;
  };
}

export class WorkerHandler {
  private worker: (Worker | null) = null;
  private mockProcessor: (WorkerProcessor | null) = null;
  private taskID = 1;

  // private holdData: { [key: string]: ResponseData } = {};
  private callbacks: { [key: string]: CallableFunction } = {};

  constructor(
    dataSetDir: string,
    costName: string,
    direct: boolean = false,
  ) {
    if (typeof dataSetDir === "undefined") {
      throw "dataSet is mandatory";
    }
    const data: RequestData = {
      taskID: this.taskID++,
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

      this.worker.addEventListener("message", (message) => {
        this.callback(message.data as ResponseData);
      });
    } else {
      this.mockProcessor = new WorkerProcessor();
    }

    this.makePromise(data);
  }

  private callback(data: ResponseData) {
    // console.log("callback", data);

    const call = this.callbacks[data.taskID.toString()];
    if (call) {
      // console.log("call", data);
      call(data);
    } else {
      throw "No callback";
      // console.log("hold", data);
      // this.holdData[data.taskID.toString()] = data;
    }
  }

  private makePromise(data: RequestData) {
    const p = new Promise<ResponseData>((resolve) => {
      // const result = this.holdData[data.taskID.toString()];
      // console.log("makePromise", data.taskID);
      // if (result) {
      //   console.log("resolve-now", data.taskID, result);
      //   resolve(result);
      // } else {
      const call = (result: ResponseData) => {
        // console.log("resolve-delay", data.taskID, result);
        resolve(result);
      };

      this.callbacks[data.taskID.toString()] = call;
      // }
    });

    if (this.worker) {
      this.worker.postMessage(data);
    } else if (this.mockProcessor) {
      const result = this.mockProcessor.process(data);
      this.callback(result);
    } else {
      throw "No real or fake worker";
    }
    return p;
  }

  terminate() {
    this.mockProcessor = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null; // release the memory.
    }
  }

  evaluate(network: NetworkInterface) {
    const data: RequestData = {
      taskID: this.taskID++,
      evaluate: {
        network: network.toJSON(),
      },
    };

    return this.makePromise(data);
  }

  train(network: NetworkInterface) {
    const json = network.toJSON();
    delete json.score;
    delete json.tags;

    const data: RequestData = {
      taskID: this.taskID++,
      train: {
        network: json,
      },
    };

    return this.makePromise(data);
  }
}
