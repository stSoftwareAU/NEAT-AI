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

let globalWorkerID=0;
export class WorkerHandler {
  private realWorker: (Worker | null) = null;
  private mockProcessor: (WorkerProcessor | null) = null;
  private taskID = 1;
  private workerID=++globalWorkerID;
  private busyCount = 0;
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
      this.realWorker = new Worker(
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

      this.realWorker.addEventListener("message", (message) => {
        this.callback(message.data as ResponseData);
      });
    } else {
      this.mockProcessor = new WorkerProcessor();
    }

    this.makePromise(data);
  }

  isBusy() {
    console.info( this.workerID, "isBusy", this.busyCount);
    return this.busyCount > 0;
  }

  addIdleListener(callback: WorkerEventListner) {
    this.idleListners.push(callback);
    console.log( this.workerID, "listners", this.idleListners.length);
  }

  private callback(data: ResponseData) {
    const call = this.callbacks[data.taskID.toString()];
    if (call) {
      call(data);
    } else {
      const msg="No callback";
      console.warn( this.workerID, msg);
      throw msg;
    }
  }

  private makePromise(data: RequestData) {
    this.busyCount++;
    const p = new Promise<ResponseData>((resolve) => {
      const call = (result: ResponseData) => {
        resolve(result);
        this.busyCount--;

        if (!this.isBusy()) {
          this.idleListners.forEach((listner) => listner(this));
        }
        else{
          console.info( this.workerID, "still busy");
        }
      };

      this.callbacks[data.taskID.toString()] = call;
    });

    if (this.realWorker) {
      this.realWorker.postMessage(data);
    } else if (this.mockProcessor) {
      const mp = this.mockProcessor.process(data);

      mp.then((result) => this.callback(result));
    } else {
      throw "No real or fake worker";
    }
    return p;
  }

  terminate() {
    if( this.isBusy()){
      console.warn( this.workerID, "terminated but still busy" );
    }
    this.mockProcessor = null;
    if (this.realWorker) {
      this.realWorker.terminate();
      this.realWorker = null; // release the memory.
    }
    this.idleListners.length = 0;
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
