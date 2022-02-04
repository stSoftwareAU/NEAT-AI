import { Network } from "../../architecture/network.js";

export class Holder {
  private worker: Worker;
  constructor(dataSet: any, costName: string) {
    console.info("Create holder");

    if (typeof dataSet === "undefined") {
      throw "dataSet is mandatory";
    }
    this.worker = new Worker(
      new URL("./deno/worker.js", import.meta.url).href,
      {
        type: "module",
      },
    );
    // console.info( "worker.postMessage( set: ", dataSet, ",costName", costName);
    this.worker.postMessage({ set: dataSet, costName: costName });
  }

  evaluate(network: Network) {
    console.info("holder.evaluate(network) new Promise");
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
        console.info("evaluate(network) resolve Promise");
        resolve(message.data);
      });
      console.info("holder.evaluate(network) postMessage(data)");
      _that.postMessage(data);
    });
  }
}
