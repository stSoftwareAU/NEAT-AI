import { Network } from "../src/architecture/network.js";

Deno.test("Holder", async () => {
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const worker = new Worker(
    new URL("../src/multithreading/workers/deno/worker.js", import.meta.url)
      .href,
    {
      type: "module",
    },
  );

  worker.postMessage({ dataSet: trainingSet, costName: "MSE" });

  const network = new Network(2, 1);
  const p = new Promise((resolve) => {
    const data = {
      network: network.toJSON(),
    };

    const _that = worker;

    _that.addEventListener("message", function callback(message) {
      resolve(message);
    });

    _that.postMessage(data);
  });

  await p;

  worker.terminate();
});
