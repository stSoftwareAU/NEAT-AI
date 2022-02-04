import { Network } from "../../architecture/network.js";

export class Holder {
  private worker: Worker;
  constructor(dataSet: any, costName: string) {

    if (typeof dataSet === "undefined") {
      throw "dataSet is mandatory";
    }
    this.worker = new Worker(
      new URL("./deno/worker.js", import.meta.url).href,
      {
        type: "module",
      },
    );
    
    this.worker.postMessage({ set: dataSet, costName: costName });
  }

  terminate(){
    this.worker.terminate();
  }

  evaluate(network: Network) {
    
    return new Promise((resolve, reject) => {
      const serialized = network.serialize();

      const data = {
        activations: serialized[0],
        states: serialized[1],
        conns: serialized[2],
      };

      const _that = this.worker;

      _that.addEventListener("message", function callback(message) {
        _that.removeEventListener("message", callback);
        
        resolve(message.data);
      });
      
      _that.postMessage(data);
    });
  }
}
