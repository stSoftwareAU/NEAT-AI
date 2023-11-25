import { assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

import { getTag } from "../src/tags/TagsInterface.ts";

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
      type: "hidden",
      squash: "TANH",
      index: 3,
      tags: [{
        name: "original",
        value: "yes",
      }],
    },
    {
      bias: 0,
      type: "output",
      squash: "IF",
      index: 4,
    },
  ],
  connections: [
    {
      weight: 1,
      from: 2,
      to: 4,
      type: "positive",
    },
    {
      weight: 1,
      from: 1,
      to: 4,
      type: "condition",
    },
    {
      weight: 1,
      from: 0,
      to: 4,
      type: "negative",
    },
    {
      weight: 0.09059831121601714,
      from: 2,
      to: 3,
    },
    {
      weight: -0.05057706266658744,
      from: 3,
      to: 4,
    },
  ],
  input: 3,
  output: 1,
};

Deno.test("addNodeValidate", () => {
  for (let j = 10; j--;) {
    const network = Network.fromJSON(json);
    for (let i = 1000; i--;) {
      network.addNode();
    }
    network.validate();
  }
});

Deno.test("addNode", () => {
  const network = Network.fromJSON(json);

  for (let i = 1000; i--;) {
    network.addNode();
  }
  const nodes = network.internalJSON().nodes;
  console.info(JSON.stringify(nodes, null, 1));

  for (let pos = nodes.length; pos--;) {
    const node = nodes[pos];
    const indx = network.input + pos;
    const tag = getTag(node, "original");

    if (tag === "yes") {
      assert(
        indx > 3,
        "Unlikely to be the first node after randomly adding 1000 nodes was: " +
          indx,
      );
    }

    if (tag === "yes") {
      assert(
        indx < 1004,
        "Unlikely to be the last node after randomly adding 1000 nodes was: " +
          indx,
      );
    }

    const to = network.toConnections(indx);

    if (node.type !== "input") {
      assert(to.length >= 1, indx + ") expected at least 1 got " + to.length);
    } else {
      assert(
        to.length == 0,
        indx + ") 'input' should not have any 'to' connections was: " +
          to.length,
      );
    }

    const from = network.fromConnections(indx);

    if (node.type !== "output") {
      assert(
        from.length >= 1,
        indx + ") expected at least 1 got " + from.length,
      );
    } else {
      assert(
        from.length == 0,
        indx + ") 'output' should not have any 'from' connections was: " +
          from.length,
      );
    }
  }
});
