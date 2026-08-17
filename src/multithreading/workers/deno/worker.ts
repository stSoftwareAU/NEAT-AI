import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";
import { setSkipWasmAutoInit } from "@globalAccessors";
import { setupWorkerMessageLoop } from "@workers/workerEntryPoint.ts";
import { getLogger } from "@utils/Logger.ts";
import { toError } from "@utils/ErrorSerialisation.ts";
import { buildWorkerErrorResponse } from "@multithreading/workers/WorkerErrorResponse.ts";

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
    getLogger().error("Worker processing error:", err);
    return buildWorkerErrorResponse(data, error, durationMs);
  },
);
