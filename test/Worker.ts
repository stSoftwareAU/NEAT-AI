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

  console.log(worker);

  console.log("postMessage");
  worker.postMessage({ set: trainingSet, costName: "MSE" });
  console.info("Posted");
  const network = new Network(2, 1);
  const p = new Promise((resolve, reject) => {
    const serialized = network.serialize();

    const data = {
      activations: serialized[0],
      states: serialized[1],
      conns: serialized[2],
    };

    const _that = worker;

    _that.addEventListener("message", function callback(message) {
      console.info("resolved Promise");
      resolve(message);
    });
    console.info("holder.evaluate(network) postMessage(data)");
    _that.postMessage(data);
  });

  const m: any = await p;
  console.info("RESULT:", m.data);

  worker.terminate();
});
