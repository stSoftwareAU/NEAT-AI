import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "../../Creature.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { NeatOptions } from "../../config/NeatOptions.ts";
import type { TrainOptions } from "../../config/TrainOptions.ts";
import { MockWorker } from "./MockWorker.ts";

/**
 * Data structure for requests sent to workers.
 *
 * Defines the format of messages sent from the main thread to worker threads
 * for various operations like evaluation, training, and discovery.
 */
export interface RequestData {
  /** Unique identifier for the task */
  taskID: number;
  /** Debug flag for verbose logging */
  debug?: boolean;
  /** Initialization data for worker setup */
  initialize?: {
    /** Directory containing the dataset */
    dataSetDir: string;
    /** Name of the cost function to use */
    costName: string;
    /** Serialized custom cost function data (if using custom cost) */
    customCostData?: string;
  };
  /** Creature evaluation request */
  evaluate?: {
    /** JSON string representation of the creature */
    creature: string;
    /** Whether to use feedback loop evaluation */
    feedbackLoop: boolean;
  };
  /** Creature training request */
  train?: {
    /** JSON string representation of the creature */
    creature: string;
    /** Training configuration options */
    options: TrainOptions;
  };
  /** Echo request for testing worker communication */
  echo?: {
    /** Message to echo back */
    message: string;
    /** Duration to wait before responding */
    ms: number;
  };
  /** Creature discovery request */
  discover?: {
    /** JSON string representation of the creature */
    creature: string;
    /** NEAT configuration options */
    options: NeatOptions;
  };
}

/**
 * Data structure for responses received from workers.
 *
 * Defines the format of messages sent from worker threads back to the main thread
 * containing results of various operations.
 */
export interface ResponseData {
  /** Unique identifier for the task */
  taskID: number;
  /** Debug flag for verbose logging */
  debug?: boolean;
  /** Duration of the operation in milliseconds */
  duration: number;
  /** Initialization response */
  initialize?: {
    /** Status of the initialization */
    status: string;
  };
  /** Evaluation response */
  evaluate?: {
    /** Error value from the evaluation */
    error: number;
  };
  /** Training response */
  train?: {
    /** Unique identifier for the training session */
    ID: string;
    /** JSON string representation of the trained creature */
    creature: string;
    /** Error value after training */
    error: number;
    /** JSON string representation of the trace data */
    trace: string;
    /** Optional compact creature representation */
    compact?: string;
    /** Optional backtracked creature representation */
    backtracked?: string;
    /** Optional forward creature representation */
    forward?: string;
  };
  /** Echo response */
  echo?: {
    /** Echoed message */
    message: string;
  };
  /** Discovery response */
  discover?: {
    /** Unique identifier for the discovery session */
    ID: string;
    /** Optional helpful synapses to add */
    addHelpfulSynapses?: CandidateSynapse[];
    /** Optional helpful neurons to add */
    addHelpfulNeurons?: CandidateNeuron[];
    /** Optional harmful synapse to remove */
    removeHarmfulSynapse?: CandidateSynapse;
    /** Optional harmful neurons to remove */
    removeHarmfulNeurons?: CandidateHarmfulNeuron[];
    /** Optional candidate activation functions */
    candidateSquashes?: CandidateSquash[];
    /** Time spent re-scoring candidates (ms) - set by DiscoveryRunner after evaluation */
    reScoringTime?: number;
  };
}

interface WorkerEventListener {
  (worker: WorkerHandler): void;
}

/**
 * Interface for worker implementations.
 *
 * Defines the contract that worker implementations must follow,
 * whether they are actual Web Workers or mock implementations.
 */
export interface WorkerInterface {
  /**
   * Adds an event listener to the worker.
   *
   * @param type - Type of event to listen for
   * @param listener - Event listener function
   * @param options - Optional event listener options
   */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  /**
   * Sends a message to the worker.
   *
   * @param data - Data to send to the worker
   */
  postMessage(data: RequestData): void;

  /**
   * Terminates the worker.
   */
  terminate(): void;
}

let globalWorkerID = 0;

/**
 * Manages communication with worker threads for parallel processing.
 *
 * This class handles the creation, communication, and lifecycle management
 * of worker threads used for evaluating, training, and discovering creatures
 * in parallel. It supports both real Web Workers and mock implementations.
 *
 * Key features:
 * - Asynchronous task execution
 * - Promise-based communication
 * - Busy state tracking
 * - Idle event notifications
 * - Error handling
 *
 * @example
 * ```ts
 * const worker = new WorkerHandler("./data", "MSE", false);
 * const result = await worker.evaluate(creature, false);
 * console.log(`Evaluation error: ${result.evaluate?.error}`);
 * ```
 */
export class WorkerHandler {
  /** The underlying worker implementation */
  private worker: WorkerInterface;

  /** Counter for generating unique task IDs */
  private taskID = 1;
  /** Unique identifier for this worker instance */
  private workerID = ++globalWorkerID;
  /** Number of currently executing tasks */
  private busyCount = 0;
  /** Map of task IDs to their callback functions */
  private callbacks = new Map<number, CallableFunction>();
  /** Listeners to notify when worker becomes idle */
  private idleListeners: WorkerEventListener[] = [];

  /**
   * Creates a new WorkerHandler instance.
   *
   * @param dataSetDir - Directory containing the dataset
   * @param costName - Name of the cost function to use
   * @param direct - Whether to use direct (mock) worker or Web Worker
   */
  constructor(
    dataSetDir: string,
    costName: string,
    direct: boolean,
    customCost?: { filePath: string },
  ) {
    let customCostData: string | undefined;

    if (customCost) {
      // File path-based custom cost
      customCostData = JSON.stringify({
        filePath: customCost.filePath,
      });
    }

    const data: RequestData = {
      taskID: this.taskID++,
      initialize: {
        dataSetDir: dataSetDir,
        costName: costName,
        customCostData,
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
      this.worker.addEventListener("error", (e) => {
        console.error("Worker error event:", e);
      });
      this.worker.addEventListener("messageerror", (e) => {
        console.error("Worker message error event:", e);
      });
    } else {
      this.worker = new MockWorker();
    }

    this.worker.addEventListener("message", (message) => {
      const me = message as MessageEvent;

      this.callback(me.data as ResponseData);
    });
    this.makePromise(data);
  }

  /**
   * Checks if the worker is currently busy with tasks.
   *
   * @returns True if the worker has pending tasks, false otherwise
   */
  isBusy() {
    return this.busyCount > 0;
  }

  /**
   * Adds a listener to be notified when the worker becomes idle.
   *
   * @param callback - Function to call when worker becomes idle
   */
  addIdleListener(callback: WorkerEventListener) {
    this.idleListeners.push(callback);
  }

  private callback(data: ResponseData) {
    const call = this.callbacks.get(data.taskID);
    assert(call, "No callback");

    // Log discovery response receipt
    if (data.discover) {
      console.log(
        `[WorkerHandler] Received discovery response for taskID: ${data.taskID}`,
      );
    }

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
    });

    // Log discovery request posting
    if (data.discover) {
      console.log(
        `[WorkerHandler] Posting discovery request to worker (taskID: ${data.taskID})`,
      );
    }

    this.worker.postMessage(data);

    return p;
  }

  terminate() {
    // Clear all pending callbacks to prevent memory leaks
    this.callbacks.clear();
    this.idleListeners.length = 0;
    this.worker.terminate();
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
        creature: JSON.stringify(creature.exportJSON()),
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

    // Immediately clear the large JSON object to help GC
    // @ts-ignore - clearing to help GC
    json.tags = null;
    // @ts-ignore - clearing to help GC
    json.neurons = null;
    // @ts-ignore - clearing to help GC
    json.synapses = null;

    return this.makePromise(data);
  }

  discover(creature: Creature, options: NeatOptions) {
    const json = creature.exportJSON();

    const data: RequestData = {
      taskID: this.taskID++,
      discover: {
        creature: JSON.stringify(json),
        options: options,
      },
    };

    // Immediately clear the large JSON object to help GC
    // @ts-ignore - clearing to help GC
    json.neurons = null;
    // @ts-ignore - clearing to help GC
    json.synapses = null;

    return this.makePromise(data);
  }
}
