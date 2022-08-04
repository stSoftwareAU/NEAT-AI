import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const json = {
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
  const network = NetworkUtil.fromJSON(json);
  network.util.validate({ nodes: 4, connections: 3 });
  network.util.subNode();
  network.util.validate({ nodes: 4 });
  for (let i = 100; i--;) {
    network.util.validate();
    network.util.addNode();
  }

  network.util.validate({ nodes: 104 });

  for (let i = 110; i--;) {
    network.util.subNode();
  }
  network.util.validate({ nodes: 4, connections: 3 });

  console.info(JSON.stringify(network.toJSON(), null, 1));
});
