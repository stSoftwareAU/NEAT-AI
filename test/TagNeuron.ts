import { assert } from "https://deno.land/std@0.216.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";

import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("TagNode", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      {
        bias: 0,
        type: "output",
        squash: "MEAN",
        index: 3,
        tags: [
          {
            name: "hello",
            value: "world",
          },
        ],
      },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const network = Creature.fromJSON(json);

  const json2 = network.exportJSON();

  const network2 = Creature.fromJSON(json2);
  const json3 = network2.exportJSON();

  const tags = json3.neurons[0].tags;
  assert(tags != null, "Should have tags");

  assert(tags.length == 1, "Should have one tag");
});
