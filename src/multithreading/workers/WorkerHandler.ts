import { Network } from "../../architecture/Network.ts";
import { NetworkInternal } from "../../architecture/NetworkInterfaces.ts";
import { MockWorker } from "./MockWorker.ts";

export interface RequestData {
  taskID: number;
  debug?: boolean;
  initialize?: {
    dataSetDir: string;
    costName: string;
  };
  evaluate?: {
    network: string;
    feedbackLoop: boolean;
  };
  train?: {
    network: string;
  };
  echo?: {
    ms: number;
    message: string;
  };
}

export interface ResponseData {
  taskID: number;
  debug?: boolean;
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
    trace: string;
  };
  echo?: {
    message: string;
  };
}

interface WorkerEventListener {
  (worker: WorkerHandler): void;
}
export interface WorkerInterface {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  postMessage(data: RequestData): void;
  terminate(): void;
}

let globalWorkerID = 0;
export class WorkerHandler {
  private worker: WorkerInterface;

  private taskID = 1;
  private workerID = ++globalWorkerID;
  private busyCount = 0;
  private callbacks: { [key: string]: CallableFunction } = {};
  private idleListeners: WorkerEventListener[] = [];

  constructor(
    dataSetDir: string,
    costName: string,
    direct: boolean = false,
  ) {
    if (typeof dataSetDir === "undefined") {
      throw new Error("dataSet is mandatory");
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
        new URL("./deno/worker.ts", import.meta.url).href,
        {
          type: "module",
          name: "worker-" + this.workerID,
        },
      );
    } else {
      this.worker = new MockWorker();
    }

    this.worker.addEventListener("message", (message) => {
      const me = message as MessageEvent;

      this.callback(me.data as ResponseData);
    });
    this.makePromise(data);
  }

  isBusy() {
    return this.busyCount > 0;
  }

  /** Notify listeners when worker no longer busy */
  addIdleListener(callback: WorkerEventListener) {
    this.idleListeners.push(callback);
  }

  private callback(data: ResponseData) {
    const call = this.callbacks[data.taskID.toString()];
    if (call) {
      call(data);
    } else {
      const msg = "No callback";
      console.warn(this.workerID, msg);
      throw new Error(msg);
    }
  }

  private makePromise(data: RequestData) {
    this.busyCount++;
    const p = new Promise<ResponseData>((resolve) => {
      const call = (result: ResponseData) => {
        resolve(result);
        this.busyCount--;

        if (!this.isBusy()) {
          this.idleListeners.forEach((listener) => listener(this));
        }
      };

      this.callbacks[data.taskID.toString()] = call;
    });

    this.worker.postMessage(data);

    return p;
  }

  terminate() {
    if (this.isBusy()) {
      console.warn(this.workerID, "terminated but still busy", this.busyCount);
    }

    this.worker.terminate();
    this.idleListeners.length = 0;
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

  evaluate(network: NetworkInternal, feedbackLoop: boolean) {
    const data: RequestData = {
      taskID: this.taskID++,
      evaluate: {
        network: JSON.stringify((network as Network).internalJSON()),
        feedbackLoop,
      },
    };

    return this.makePromise(data);
  }

  train(network: NetworkInternal) {
    const json = (network as Network).exportJSON();

    delete json.tags;

    const data: RequestData = {
      taskID: this.taskID++,
      train: {
        network: JSON.stringify(json),
      },
    };

    return this.makePromise(data);
  }
}
