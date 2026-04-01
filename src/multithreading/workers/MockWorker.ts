import type { WorkerInterface } from "@workers/WorkerInterface.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";

import { WorkerProcessor } from "@multithreading/workers/WorkerProcessor.ts";
import { getLogger } from "@utils/Logger.ts";
import { toError, toErrorMessage } from "@utils/ErrorSerialisation.ts";

export class MockWorker implements WorkerInterface<RequestData> {
  private callBack: EventListener | null = null;

  addEventListener(
    _type: string,
    listener: EventListener,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    this.callBack = listener;
  }

  private processor = new WorkerProcessor();
  postMessage(data: RequestData, _transfer?: Transferable[]) {
    // Issue #1428: Validate that the payload is structured-clone safe, just
    // like a real Worker.postMessage() would. This catches non-cloneable data
    // (functions, symbols, etc.) that would cause a DataCloneError in production.
    structuredClone(data);

    this.processor.process(data).then((result) => {
      type MockEvent = Event & { data: ResponseData };
      const me = new Event("mock") as MockEvent;
      me.data = result;
      if (this.callBack) {
        this.callBack(me);
      }
    }).catch((error) => {
      const err = toError(error);
      getLogger().error("MockWorker processing error:", err);
      // Issue #1761: Include standardised error details
      const errorResponse: ResponseData = {
        taskID: data.taskID,
        duration: 0,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      };

      // Add operation-specific error field based on request type
      if (data.evaluate) {
        errorResponse.evaluate = {
          error: Number.POSITIVE_INFINITY,
        };
      } else if (data.train) {
        errorResponse.train = {
          ID: "error",
          creature: { input: 0, output: 0, neurons: [], synapses: [] },
          error: Number.POSITIVE_INFINITY,
          trace: { input: 0, output: 0, neurons: [], synapses: [] },
        };
      } else if (data.discover) {
        errorResponse.discover = {
          ID: "error",
        };
      } else if (data.echo) {
        errorResponse.echo = {
          message: `Error: ${toErrorMessage(error)}`,
        };
      } else if (data.configureCache) {
        errorResponse.configureCache = {
          status: `ERROR: ${toErrorMessage(error)}`,
        };
      } else if (data.requestCacheStats) {
        errorResponse.cacheStats = {
          activationCacheCount: 0,
          activationCacheMax: 0,
          compilationCacheSize: 0,
          compilationCacheMax: 0,
        };
      } else if (data.initialize) {
        errorResponse.initialize = {
          status: "ERROR",
          error: toErrorMessage(error),
        };
      } else if (data.breed) {
        errorResponse.breed = {
          success: false,
        };
      }

      if (this.callBack) {
        type MockEvent = Event & { data: ResponseData };
        const me = new Event("mock") as MockEvent;
        me.data = errorResponse;
        this.callBack(me);
      }
    });
  }

  terminate(): void {
    // Clean up references to prevent memory leaks
    this.callBack = null;
    // @ts-ignore - clearing processor reference
    this.processor = null;
  }
}
