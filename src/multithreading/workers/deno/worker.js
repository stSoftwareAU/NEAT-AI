import { WorkerProcessor } from "../WorkerProcessor.ts";

const processor = new WorkerProcessor();

self.onmessage = function (message) {
  const result = processor.process(message.data);
  self.postMessage(result);
};
