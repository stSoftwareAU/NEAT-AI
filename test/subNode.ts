import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const json: NetworkInternal = {
  nodes: [
    {
      type: "input",
      squash: "LOGISTIC",
      index: 0,
    },
    {
      type: "input",
      squash: "LOGISTIC",
      index: 1,
    },
    {
      type: "input",
      squash: "LOGISTIC",
      index: 2,
    },
    {
      bias: 0,
      type: "output",
      squash: "IF",
      index: 3,
    },
  ],
  connections: [
    {
      weight: 1,
      from: 0,
      to: 3,
      type: "negative",
    },
    {
      weight: 1,
      from: 1,
      to: 3,
      type: "condition",
    },
    {
      weight: 1,
      from: 2,
      to: 3,
      type: "positive",
    },
  ],
  input: 3,
  output: 1,
};

Deno.test("subNode", () => {
  const network = Network.fromJSON(json);
  network.validate({ nodes: 4, connections: 3 });
  network.subNode();
  network.validate({ nodes: 4 });
  for (let i = 100; i--;) {
    network.validate();
    network.addNode();
  }

  network.validate({ nodes: 104 });

  for (let i = 110; i--;) {
    network.subNode();
  }
  network.validate({ nodes: 4, connections: 3 });

  console.info(JSON.stringify(network.exportJSON(), null, 1));
});
