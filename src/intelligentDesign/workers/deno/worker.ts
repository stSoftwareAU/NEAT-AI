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

workerHandler.onmessage = function (message: { data: RequestData }) {
  const result = processor.process(message.data);

  workerHandler.postMessage(result);
};
