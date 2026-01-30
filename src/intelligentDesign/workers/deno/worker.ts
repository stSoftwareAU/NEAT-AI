/**
 * Deno worker entry point for Intelligent Design scoring operations.
 *
 * @module
 */

import type { RequestData } from "../WorkerHandler.ts";
import type { ResponseData } from "../ResponseData.ts";
import { WorkerProcessor } from "../WorkerProcessor.ts";

const processor = new WorkerProcessor();
const workerHandler =
  // deno-lint-ignore ban-types
  (self as unknown) as { onmessage: Function; postMessage: Function };

/** Max time for init so caller gets a response instead of hanging (Issue #1260). */
const INIT_TIMEOUT_MS = 15_000;

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
