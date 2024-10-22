import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags";
import type { Creature } from "../../Creature.ts";
import type { TrainOptions } from "../../config/TrainOptions.ts";
import { MockWorker } from "./MockWorker.ts";

export interface RequestData {
  taskID: number;
  debug?: boolean;
  initialize?: {
    dataSetDir: string;
    costName: string;
  };
  evaluate?: {
    creature: string;
    feedbackLoop: boolean;
  };
  train?: {
    creature: string;
    options: TrainOptions;
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
    ID: string;
    creature: string;
    error: number;
    trace: string;
    compact?: string;
    tuned?: string;
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
  private callbacks = new Map<number, CallableFunction>();
  private idleListeners: WorkerEventListener[] = [];

  constructor(
    dataSetDir: string,
    costName: string,
    direct: boolean,
  ) {
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
    const call = this.callbacks.get(data.taskID);
    assert(call, "No callback");
    call(data);
    this.callbacks.delete(data.taskID);
  }

  private makePromise(data: RequestData) {
    this.busyCount++;
    const p = new Promise<ResponseData>((resolve) => {
      const call = (result: ResponseData) => {
        this.busyCount--;

        resolve(result);

        if (!this.isBusy()) {
          this.idleListeners.forEach((listener) => listener(this));
        }
      };

      this.callbacks.set(data.taskID, call);
      return call;
    });

    this.worker.postMessage(data);

    return p;
  }

  terminate() {
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

  evaluate(creature: Creature, feedbackLoop: boolean) {
    const data: RequestData = {
      taskID: this.taskID++,
      evaluate: {
        creature: JSON.stringify(creature.internalJSON()),
        feedbackLoop,
      },
    };

    return this.makePromise(data);
  }

  train(creature: Creature, options: TrainOptions) {
    const json = creature.exportJSON();

    delete json.tags;

    addTag(
      json,
      "untrained-error",
      `${getTag(creature, "error")}`,
    );
    addTag(
      json,
      "untrained-score",
      `${creature.score}`,
    );

    const data: RequestData = {
      taskID: this.taskID++,
      train: {
        creature: JSON.stringify(json),
        options: options,
      },
    };

    return this.makePromise(data);
  }
}
