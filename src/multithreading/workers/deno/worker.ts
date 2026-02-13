import type { RequestData, ResponseData } from "../WorkerHandler.ts";
import "../../../globals.d.ts";

// Issue #1263: WASM activation is mandatory. For the library's internal worker
// system, workers receive the WASM payload from the parent during init, so we
// skip module-evaluation auto-init to reduce worker start flakiness.
globalThis.__NEAT_AI_SKIP_WASM_AUTO_INIT = true;

const { WorkerProcessor } = await import("../WorkerProcessor.ts");
const { getLogger } = await import("../../../utils/Logger.ts");
const processor = new WorkerProcessor();

/** Typed handle for the Deno Worker global scope. */
interface WorkerSelf {
  onmessage: ((message: { data: RequestData }) => void) | null;
  postMessage: (data: ResponseData) => void;
}
const workerHandler = self as unknown as WorkerSelf;

/** Issue #1260: Max time for init so caller gets a response instead of hanging. */
const INIT_TIMEOUT_MS = (() => {
  // In a Worker context, env access may be restricted; treat as best-effort.
  try {
    const v = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
    if (v === null || v === undefined || v === "") return 60_000;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1000 ? n : 60_000;
  } catch {
    return 60_000;
  }
})();

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
    getLogger().error("Worker processing error:", error);
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
