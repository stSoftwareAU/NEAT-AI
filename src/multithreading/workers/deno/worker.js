import { Multi } from "../../../multithreading/multi.js";
import { Cost } from "../../../methods/cost.js";

self.set = [];
self.cost = null;

self.onmessage = (message) => {
  const data = message.data;

  if (typeof data.set === "undefined") {
    const result = Multi.testSerializedSet(
      self.set,
      self.cost,
      data.activations,
      data.states,
      data.conns,
    );

    self.postMessage(result);
  } else {
    self.cost = Cost[data.costName];

    self.set = data.set;
  }
};
