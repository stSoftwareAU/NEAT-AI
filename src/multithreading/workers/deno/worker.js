import { Multi } from "../../../multithreading/multi.js";
import { Methods } from "../../../methods/methods.js";

let set = [];
let cost;
const F = Multi.activations;

self.onmessage = (e) => {
  if (typeof e.set === "undefined") {
    // console.log( "Calculate", e);

    const A = e.activations;
    const S = e.states;
    const data = e.conns;

    const result = Multi.testSerializedSet(set, cost, A, S, data, F);
    postMessage(result);

    self.close();
  } else {
    // console.log( "Initialize", e);
    cost = Methods.cost[e.cost];
    set = Multi.deserializeDataSet(e.set);
  }
};
