import { Multi } from "../../../multithreading/multi.js";
import { Cost } from "../../../methods/cost.js";

self.set=[];
self.cost=null;
// const F = Multi.activations;

self.onload=()=>{
  console.info(console.info( "worker.onload", e));
}
self.onunload=()=>{
  console.info(console.info( "worker.onunload", e));
}
self.onmessage = (message) => {

  // console.info( "worker.onmessage", message);
  
  // console.info("TYPEOF: ",  typeof message.data );
  
  const data= message.data;
  // console.info( "data", data);
  if (typeof data.set === "undefined") {
    console.log( "Worker: Calculate");

    const result = Multi.testSerializedSet(
      self.set, 
      self.cost, 
      data.activations, 
      data.states, 
      data.conns, 
      Multi.activations
    );
    postMessage(result);

    // self.close();
  } else {
    console.log( "Worker: Initialize", data);
    self.cost = Cost[data.costName];
    console.info( "Cost: ", self.cost);
    self.set = data.set;//Multi.deserializeDataSet(data.set);
  }
};
