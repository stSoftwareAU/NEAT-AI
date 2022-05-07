import { WorkerProcessor } from "../WorkerProcessor.ts";

const processor = new WorkerProcessor();

self.onmessage = async function (message) {
  const result = await processor.process(message.data);

  self.postMessage(result);
};
