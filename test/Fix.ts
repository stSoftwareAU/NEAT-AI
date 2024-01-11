import { assertEquals } from "https://deno.land/std@0.211.0/assert/mod.ts";

import { Creature } from "../src/Creature.ts";
import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("FromFrom", () => {
  const json: CreatureInternal = {
    nodes: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3, uuid: "h1" },

      {
        type: "output",
        squash: "IDENTITY",
        index: 4,
        uuid: "h6",
        bias: 0,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 5,
        uuid: "h7",
        bias: 0,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 6,
        uuid: "h8",
        bias: 0,
      },
    ],
    connections: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 3, to: 4, weight: 0.2 },
      { from: 4, to: 5, weight: 0.3 },
      { from: 5, to: 6, weight: 0.4 },
    ],
    input: 3,
    output: 3,
  };
  const network = Creature.fromJSON(json);

  network.validate();

  const preFixJSON = network.exportJSON();
  network.fix();
  const postFixJSON = network.exportJSON();
  assertEquals(preFixJSON, postFixJSON);
});
