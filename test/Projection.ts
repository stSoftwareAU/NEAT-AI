import { assert } from "https://deno.land/std@0.150.0/testing/asserts.ts";

import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("projection", () => {
  const json: NetworkInterface = {
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
  const network = NetworkUtil.fromJSON(json);

  const outNode = network.nodes[3];

  const inNode0 = network.nodes[0];

  const flag0to3 = inNode0.isProjectingTo(outNode);

  assert(flag0to3, "0 -> 3");

  const flag3to0 = outNode.isProjectingTo(inNode0);

  assert(!flag3to0, "3 -> 0 should not be associated");

  const project3by0 = outNode.isProjectedBy(inNode0);

  assert(project3by0, "3 is projected by 0");
});
