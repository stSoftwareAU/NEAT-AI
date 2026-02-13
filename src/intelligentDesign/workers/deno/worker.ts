/**
 * Deno worker entry point for Intelligent Design scoring operations.
 *
 * @module
 */

import type { RequestData } from "../WorkerHandler.ts";
import type { ResponseData } from "../ResponseData.ts";
import "../../../globals.d.ts";

// Issue #1263: WASM activation is mandatory. For the library's internal worker
// system, workers receive the WASM payload from the parent during init, so we
// skip module-evaluation auto-init to reduce worker start flakiness.
globalThis.__NEAT_AI_SKIP_WASM_AUTO_INIT = true;

const { WorkerProcessor } = await import("../WorkerProcessor.ts");
const processor = new WorkerProcessor();

/** Typed handle for the Deno Worker global scope. */
interface WorkerSelf {
  onmessage: ((message: { data: RequestData }) => void) | null;
  postMessage: (data: ResponseData) => void;
}
const workerHandler = self as unknown as WorkerSelf;

/** Max time for init so caller gets a response instead of hanging (Issue #1260). */
const INIT_TIMEOUT_MS = (() => {
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
  const start = Date.now();
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
    const err = error instanceof Error ? error : new Error(String(error));
    workerHandler.postMessage({
      taskID: message.data.taskID,
      duration: Date.now() - start,
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    });
  }
};
