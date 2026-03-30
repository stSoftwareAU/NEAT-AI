/**
 * Worker handler for Intelligent Design scoring operations.
 *
 * Extends WorkerHandlerBase for shared lifecycle management (Issue #1600).
 *
 * @module
 */

import { assert } from "@std/assert";
import type { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { ResponseData } from "@intelligentDesign/workers/ResponseData.ts";
import { MockWorker } from "@intelligentDesign/workers/MockWorker.ts";
import {
  getInitTimeoutMs,
  WorkerHandlerBase,
} from "@workers/WorkerHandlerBase.ts";
import type { WorkerInterface } from "@workers/WorkerInterface.ts";
import {
  loadWasmActivationInitPayloadAsync,
} from "@workers/WasmActivationPayload.ts";

// Re-export shared type for backwards compatibility.
export type {
  WasmActivationInitPayload,
} from "@workers/WasmActivationPayload.ts";

/**
 * Data structure for requests sent to scoring workers.
 */
export interface RequestData {
  /** Unique identifier for the task */
  taskID: number;
  /** Initialization request (sent once per worker) */
  initialize?: {
    wasmActivation:
      import("../../workers/WasmActivationPayload.ts").WasmActivationInitPayload;
  };
  /** Score request data */
  score?: {
    /** UUID of the neuron being tested */
    uuid: string;
    /** JSON string representation of the creature */
    creature: string;
    /** Directory containing scoring data */
    dataDir: string;
    /** NEAT options including custom cost configuration */
    options: NeatOptions;
  };
}

// Re-export WorkerInterface for backwards compatibility.
export type { WorkerInterface } from "@workers/WorkerInterface.ts";

/**
 * Manages communication with worker threads for parallel scoring operations.
 *
 * Extends WorkerHandlerBase for shared lifecycle management (Issue #1600).
 *
 * @example
 * ```ts
 * const worker = new WorkerHandler();
 * const result = await worker.score(creature, neuronId, dataDir, options);
 * getLogger().info(`Score: ${result.score?.score}`);
 * worker.terminate();
 * ```
 */
export class WorkerHandler
  extends WorkerHandlerBase<RequestData, ResponseData> {
  /**
   * Creates a new WorkerHandler instance.
   */
  constructor(direct: boolean = false) {
    let rejectInitError: ((err: Error) => void) | null = null;
    const initErrorPromise: Promise<never> = new Promise((_, reject) => {
      rejectInitError = reject;
    });

    const workerUrl = new URL("./deno/worker.ts", import.meta.url).href;

    let capturedInitError: Error | undefined;
    const onInitError = (err: Error) => {
      if (!capturedInitError) capturedInitError = err;
      rejectInitError?.(err);
      rejectInitError = null;
    };

    const worker = WorkerHandlerBase.createWorkerOrMock<RequestData>(
      direct,
      workerUrl,
      "id-worker-" + (++WorkerHandler.nextWorkerIDForConstruction),
      () => new MockWorker() as unknown as WorkerInterface<RequestData>,
      onInitError,
    );

    const INIT_RESPONSE_TIMEOUT_MS = getInitTimeoutMs();

    // Deferred init pattern: super() must be called before `this` is available.
    let resolveInitReady!: (value: ResponseData) => void;
    let rejectInitReady!: (err: Error) => void;
    const initReady = new Promise<ResponseData>((resolve, reject) => {
      resolveInitReady = resolve;
      rejectInitReady = reject;
    });

    super(worker, initReady);

    this.initWorkerError = capturedInitError;

    // Async initialisation.
    loadWasmActivationInitPayloadAsync().then(
      (wasmActivation) => {
        const initReq: RequestData = {
          taskID: this.taskID++,
          initialize: { wasmActivation },
        };
        return this.createInitSequence(
          initReq,
          initErrorPromise,
          INIT_RESPONSE_TIMEOUT_MS,
        );
      },
    ).then((result) => {
      rejectInitError = null;
      assert(
        result.initialize?.status === "OK" && !result.error,
        result.error?.message ??
          "Intelligent Design worker initialization failed",
      );
      return result;
    }).then(resolveInitReady, rejectInitReady);
  }

  /** Static counter used during construction (before super assigns workerID). */
  private static nextWorkerIDForConstruction = 0;

  /**
   * Sends a score request to the worker.
   *
   * @param creature - The creature to score
   * @param uuid - UUID of the neuron being tested
   * @param dataDir - Directory containing scoring data
   * @param options - NEAT options (can include customCost)
   * @returns Promise resolving to the scoring result
   */
  score(
    creature: Creature,
    uuid: string,
    dataDir: string,
    options: NeatOptions,
  ): Promise<ResponseData> {
    return this.ready.then(() => {
      const data: RequestData = {
        taskID: this.taskID++,
        score: {
          creature: JSON.stringify(creature.exportJSON(), null, 1),
          uuid: uuid,
          dataDir: dataDir,
          options: options,
        },
      };

      return this.makePromise(data);
    });
  }
}
