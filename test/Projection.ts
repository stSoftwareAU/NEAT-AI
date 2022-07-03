import { assert } from "https://deno.land/std@0.140.0/testing/asserts.ts";

import { Network } from "../../NEAT-TS/src/architecture/network.js";

Deno.test("projection", () => {
  const json = {
    nodes: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      {
        type: "output",
        squash: "IF",
        index: 3,
        bias: 0,
      },
    ],
    connections: [
      { from: 2, to: 3, weight: 1, type: "positive" },
      { from: 1, to: 3, weight: 1, type: "condition" },
      { from: 0, to: 3, weight: 1, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const network = Network.fromJSON(json);

  const outNode = network.nodes[3];

  const inNode0 = network.nodes[0];

  const flag0to3 = inNode0.isProjectingTo(outNode);

  assert(flag0to3, "0 -> 3");

  const flag3to0 = outNode.isProjectingTo(inNode0);

  assert(!flag3to0, "3 -> 0 should not be associated");

  const project3by0 = outNode.isProjectedBy(inNode0);

  assert(project3by0, "3 is projected by 0");
});
