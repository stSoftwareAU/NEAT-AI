import { Cost } from "../../../methods/cost.js";
import { Network } from "../../../architecture/network.js";

self.dataSet = null;
self.cost = null;

self.onmessage = (message) => {
  const data = message.data;

  if (typeof data.dataSet === "undefined") {
    const network = Network.fromJSON(data.network);
    const result = network.test(self.dataSet, self.cost);

    self.postMessage(result);
  } else {
    self.cost = Cost[data.costName];

    self.dataSet = data.dataSet;
  }
};
