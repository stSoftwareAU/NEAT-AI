import { NetworkInterface } from "../../architecture/NetworkInterface.ts";

import { WorkerProcessor } from "./WorkerProcessor.ts";
import { addTag, getTag } from "../../tags/TagsInterface.ts";

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
    rate: number;
  };
  echo?: {
    ms: number;
    message: string;
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
  echo?: {
    message: string;
  };
}

interface WorkerEventListner {
  (worker: WorkerHandler): void;
}

export class WorkerHandler {
  private worker: (Worker | null) = null;
  private mockProcessor: (WorkerProcessor | null) = null;
  private taskID = 1;
  private busy = false;
  private callbacks: { [key: string]: CallableFunction } = {};
  private idleListners: WorkerEventListner[] = [];

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

  isBusy() {
    return this.busy;
  }

  addIdleListener(callback: WorkerEventListner) {
    this.idleListners.push(callback);
  }

  private callback(data: ResponseData) {
    const call = this.callbacks[data.taskID.toString()];
    if (call) {
      call(data);
    } else {
      throw "No callback";
    }
  }

  private makePromise(data: RequestData) {
    this.busy = true;
    const p = new Promise<ResponseData>((resolve) => {
      const call = (result: ResponseData) => {
        resolve(result);
        this.busy = false;

        this.idleListners.forEach((listner) => listner(this));
      };

      this.callbacks[data.taskID.toString()] = call;
    });

    if (this.worker) {
      this.worker.postMessage(data);
    } else if (this.mockProcessor) {
      const mp = this.mockProcessor.process(data);

      mp.then((result) => this.callback(result));
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
    this.idleListners.length=0;
  }

  echo(message: string, ms: number) {
    const data: RequestData = {
      taskID: this.taskID++,
      echo: {
        message: message,
        ms: ms,
      },
    };

    return this.makePromise(data);
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

  train(network: NetworkInterface, rate: number) {
    const json = network.toJSON();
    delete json.score;
    delete json.tags;
    const error = getTag(network, "error");
    if (error) {
      addTag(json, "untrained", error);
    }
    const data: RequestData = {
      taskID: this.taskID++,
      train: {
        network: json,
        rate: rate,
      },
    };

    return this.makePromise(data);
  }
}
