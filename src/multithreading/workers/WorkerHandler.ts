import { assert } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { addTag, getTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../../Creature.ts";
import { TrainOptions } from "../../config/TrainOptions.ts";
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
    network: string;
    error: number;
    trace: string;
    compact?: string;
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
    assert(dataSetDir, "dataSet is mandatory");
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
    assert(this.busyCount >= 0, "Invalid busy count");

    this.busyCount++;
    const p = new Promise<ResponseData>((resolve) => {
      let alreadyCalled = false;
      const call = (result: ResponseData) => {
        assert(!alreadyCalled, "Already called");
        this.busyCount--;
        alreadyCalled = true;

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
    assert(!this.isBusy(), "Worker is busy");

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
