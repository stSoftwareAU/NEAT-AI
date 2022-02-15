import { Multi } from "../../../multithreading/multi.js";
import { Cost } from "../../../methods/cost.js";

self.dataSet = null;
self.cost = null;

self.onmessage = (message) => {
  const data = message.data;

  if (typeof data.dataSet === "undefined") {
    const result = Multi.testSerializedSet(
      self.dataSet,
      self.cost,
      data.activations,
      data.states,
      data.conns,
    );

    self.postMessage(result);
  } else {
    self.cost = Cost[data.costName];

    self.dataSet = data.dataSet;
  }
};
