import { Cost } from "../../../methods/cost.js";
import { Network } from "../../../architecture/network.js";

self.dataSetDir = null;
self.cost = null;

self.onmessage = function (message) {
  const data = message.data;

  if (typeof data.dataSetDir === "undefined") {
    const network = Network.fromJSON(data.network);
    const result = network.test(self.dataSetDir, self.cost);

    self.postMessage(result);
  } else {
    self.cost = Cost[data.costName];

    self.dataSetDir = data.dataSetDir;
  }
};
