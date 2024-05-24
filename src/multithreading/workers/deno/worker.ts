import type { RequestData } from "../WorkerHandler.ts";
import { WorkerProcessor } from "../WorkerProcessor.ts";

const processor = new WorkerProcessor();
const workerHandler =
  // deno-lint-ignore ban-types
  (self as unknown) as { onmessage: Function; postMessage: Function };

workerHandler.onmessage = async function (message: { data: RequestData }) {
  const result = await processor.process(message.data);

  workerHandler.postMessage(result);
};
