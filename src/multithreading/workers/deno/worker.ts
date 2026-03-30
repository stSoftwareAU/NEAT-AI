import type { RequestData, ResponseData } from "../WorkerHandler.ts";
import { setSkipWasmAutoInit } from "@globalAccessors";
import { setupWorkerMessageLoop } from "../../../workers/workerEntryPoint.ts";
import { toError, toErrorMessage } from "@utils/ErrorSerialisation.ts";

// Issue #1263: WASM activation is mandatory. For the library's internal worker
// system, workers receive the WASM payload from the parent during init, so we
// skip module-evaluation auto-init to reduce worker start flakiness.
setSkipWasmAutoInit(true);

const { WorkerProcessor } = await import("../WorkerProcessor.ts");
const { getLogger } = await import("../../../utils/Logger.ts");
const processor = new WorkerProcessor();

// Issue #1600: Use shared worker message loop infrastructure.
setupWorkerMessageLoop<RequestData, ResponseData>(
  processor,
  (data, error, durationMs) => {
    const err = toError(error);
    getLogger().error("Worker processing error:", err);
    // Issue #1761: Include standardised error details
    const errorResponse: ResponseData = {
      taskID: data.taskID,
      duration: durationMs,
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
        creature: "",
        error: Number.POSITIVE_INFINITY,
        trace: "",
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

    return errorResponse;
  },
);
