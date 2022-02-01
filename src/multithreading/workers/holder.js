export default function Holder(dataSet, cost) {
  this.worker = new Worker(new URL("./deno/worker.js", import.meta.url).href, {
    type: "module",
  });
  this.worker.postMessage({ set: dataSet, cost: cost.name });
}

Holder.prototype = {
  evaluate: function (network) {
    return new Promise((resolve, reject) => {
      const serialized = network.serialize();

      const data = {
        activations: serialized[0],
        states: serialized[1],
        conns: serialized[2],
      };

      //   const _that = this.worker;
      //   this.worker.on("message", function callback(e) {
      //     _that.removeListener("message", callback);
      //     resolve(e);
      //   });

      this.worker.postMessage(data);
    });
  },

  terminate: function () {
    this.worker.terminate();
  },
};
