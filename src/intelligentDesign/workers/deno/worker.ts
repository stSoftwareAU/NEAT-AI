/**
 * Deno worker entry point for Intelligent Design scoring operations.
 *
 * Issue #1600: Uses shared worker message loop infrastructure.
 *
 * @module
 */

import type { RequestData } from "../WorkerHandler.ts";
import type { ResponseData } from "../ResponseData.ts";
import { setSkipWasmAutoInit } from "@globalAccessors";
import { setupWorkerMessageLoop } from "../../../workers/workerEntryPoint.ts";
import { toError } from "@utils/ErrorSerialisation.ts";

// Issue #1263: WASM activation is mandatory. For the library's internal worker
// system, workers receive the WASM payload from the parent during init, so we
// skip module-evaluation auto-init to reduce worker start flakiness.
setSkipWasmAutoInit(true);

const { WorkerProcessor } = await import("../WorkerProcessor.ts");
const processor = new WorkerProcessor();

// Issue #1600: Use shared worker message loop infrastructure.
setupWorkerMessageLoop<RequestData, ResponseData>(
  processor,
  (data, error, durationMs) => {
    const err = toError(error);
    return {
      taskID: data.taskID,
      duration: durationMs,
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    };
  },
);
