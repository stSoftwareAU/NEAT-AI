import type { RequestData, ResponseData } from "../WorkerHandler.ts";
import { WorkerProcessor } from "../WorkerProcessor.ts";

const processor = new WorkerProcessor();
const workerHandler =
  // deno-lint-ignore ban-types
  (self as unknown) as { onmessage: Function; postMessage: Function };

/** Issue #1260: Max time for init so caller gets a response instead of hanging. */
const INIT_TIMEOUT_MS = 15_000;

workerHandler.onmessage = async function (message: { data: RequestData }) {
  try {
    let result: ResponseData;
    if (message.data.initialize) {
      const timeoutPromise = new Promise<ResponseData>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `Worker init timed out after ${
                  INIT_TIMEOUT_MS / 1000
                }s (WASM may still be loading)`,
              ),
            ),
          INIT_TIMEOUT_MS,
        );
      });
      result = await Promise.race([
        processor.process(message.data),
        timeoutPromise,
      ]);
    } else {
      result = await processor.process(message.data);
    }
    workerHandler.postMessage(result);
  } catch (error) {
    console.error("Worker processing error:", error);
    // Create a proper error response with operation-specific error field
    const errorResponse: ResponseData = {
      taskID: message.data.taskID,
      duration: 0,
    };

    // Add operation-specific error field based on request type
    if (message.data.evaluate) {
      errorResponse.evaluate = {
        error: Number.POSITIVE_INFINITY, // Use infinity to indicate evaluation failure
      };
    } else if (message.data.train) {
      errorResponse.train = {
        ID: "error",
        creature: "",
        error: Number.POSITIVE_INFINITY, // Use infinity to indicate training failure
        trace: "",
      };
    } else if (message.data.discover) {
      errorResponse.discover = {
        ID: "error",
      };
    } else if (message.data.echo) {
      errorResponse.echo = {
        message: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    } else if (message.data.initialize) {
      errorResponse.initialize = {
        status: "ERROR",
        error: error instanceof Error ? error.message : String(error),
      };
    } else if (message.data.breed) {
      // Issue #1026: Handle breeding errors
      errorResponse.breed = {
        success: false,
      };
    }

    workerHandler.postMessage(errorResponse);
  }
};
