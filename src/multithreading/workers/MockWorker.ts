import type { WorkerInterface } from "@workers/WorkerInterface.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";

import { WorkerProcessor } from "@multithreading/workers/WorkerProcessor.ts";
import { getLogger } from "@utils/Logger.ts";
import { toError, toErrorMessage } from "@utils/ErrorSerialisation.ts";
import { clearForGc } from "@utils/ReleasableRef.ts";

/**
 * Issue #3476: cached result of the `NEAT_AI_VALIDATE_CLONE` env check.
 *
 * The MockWorker validation clone (see `postMessage`) is a debug-only aid, so
 * the env is read once and cached — the happy path must not pay a per-message
 * env read. Missing env permission is not a fault to surface here: it simply
 * means the opt-in debug validation is unavailable, so it stays disabled.
 */
let cloneValidationEnv: boolean | undefined;

function isCloneValidationEnvEnabled(): boolean {
  if (cloneValidationEnv === undefined) {
    try {
      cloneValidationEnv = Deno.env.get("NEAT_AI_VALIDATE_CLONE") === "1";
    } catch {
      // Env permission not granted: the opt-in validation is unavailable.
      cloneValidationEnv = false;
    }
  }
  return cloneValidationEnv;
}

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
    //
    // Issue #3476: MockWorker runs only on the single-thread path (threads === 1)
    // and the init-failure fallback — there is NO cross-thread boundary, so this
    // clone can never prevent a real DataCloneError; it just deep-copies the whole
    // creature payload once per evaluate/train/discover/breed and throws it away.
    // Gate it behind an explicit debug opt-in so production single-thread runs skip
    // the wasted copy, while dev/test runs can still exercise the #1428 detection.
    // Multi-thread runs (threads > 1) still go through the real Worker.postMessage,
    // which throws DataCloneError on a non-cloneable payload regardless of this flag,
    // and test/Multithreading/WorkerPayloadCloneability.ts guards the invariant.
    if (data.debug === true || isCloneValidationEnvEnabled()) {
      structuredClone(data);
    }

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
    clearForGc(this, "processor");
  }
}
