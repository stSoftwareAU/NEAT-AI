import type { RequestData, ResponseData } from "../WorkerHandler.ts";
import { WorkerProcessor } from "../WorkerProcessor.ts";

const processor = new WorkerProcessor();
const workerHandler =
  // deno-lint-ignore ban-types
  (self as unknown) as { onmessage: Function; postMessage: Function };

workerHandler.onmessage = async function (message: { data: RequestData }) {
  try {
    const result = await processor.process(message.data);
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
      };
    }

    workerHandler.postMessage(errorResponse);
  }
};
