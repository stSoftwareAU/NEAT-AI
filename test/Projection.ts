import { assert } from "https://deno.land/std@0.212.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";

import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { Node } from "../src/architecture/Node.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("projection", () => {
  const json: CreatureInternal = {
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
  const network = Creature.fromJSON(json);

  const outNode = network.nodes[3];

  const inNode0 = network.nodes[0];

  const flag0to3 = (inNode0 as Node).isProjectingTo(outNode as Node);

  assert(flag0to3, "0 -> 3");

  const flag3to0 = (outNode as Node).isProjectingTo(inNode0 as Node);

  assert(!flag3to0, "3 -> 0 should not be associated");

  const project3by0 = (outNode as Node).isProjectedBy(inNode0 as Node);

  assert(project3by0, "3 is projected by 0");
});
