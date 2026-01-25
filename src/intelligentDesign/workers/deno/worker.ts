/**
 * Deno worker entry point for Intelligent Design scoring operations.
 *
 * @module
 */

import type { RequestData } from "../WorkerHandler.ts";
import { WorkerProcessor } from "../WorkerProcessor.ts";

const processor = new WorkerProcessor();
const workerHandler =
  // deno-lint-ignore ban-types
  (self as unknown) as { onmessage: Function; postMessage: Function };

workerHandler.onmessage = async function (message: { data: RequestData }) {
  const start = Date.now();
  try {
    const result = await processor.process(message.data);
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
