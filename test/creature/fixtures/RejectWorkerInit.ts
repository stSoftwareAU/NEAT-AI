import { buildWorkerErrorResponse } from "@multithreading/workers/WorkerErrorResponse.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<RequestData>) => void;
  postMessage: (response: ResponseData) => void;
};
scope.onmessage = (event) => {
  scope.postMessage(
    buildWorkerErrorResponse(
      event.data,
      new Error("fixture worker init rejected"),
      0,
    ),
  );
};
