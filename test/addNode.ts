import { assert } from "https://deno.land/std@0.140.0/testing/asserts.ts";

import { Network } from "../../NEAT-TS/src/architecture/network.js";
import { getTag } from "../src/tags/TagsInterface.ts";

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

Deno.test("addNode", () => {
  const network = Network.fromJSON(json);

  for (let i = 100; i--;) {
    network.util.addNode();
  }
  const nodes = network.toJSON().nodes;
  console.info(JSON.stringify(nodes, null, 1));

  for (let indx = nodes.length; indx--;) {
    const node = nodes[indx];
    const tag = getTag(node, "original");

    if (tag === "yes") {
      assert(
        indx > 3,
        "Unlikely to be the first node after randomly adding 100 nodes was: " +
          indx,
      );
    }

    if (tag === "yes") {
      assert(
        indx < 104,
        "Unlikely to be the last node after randomly adding 100 nodes was: " +
          indx,
      );
    }

    const to = network.util.toConnections(indx);

    if (node.type !== "input") {
      assert(to.length >= 1, indx + ") expected at least 1 got " + to.length);
    } else {
      assert(
        to.length == 0,
        indx + ") 'input' should not have any 'to' connections was: " +
          to.length,
      );
    }

    const from = network.util.fromConnections(indx);

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
