import { assert } from "https://deno.land/std@0.220.1/assert/mod.ts";
import { Creature } from "../src/Creature.ts";

import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { Neuron } from "../src/architecture/Neuron.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("projection", () => {
  const json: CreatureInternal = {
    neurons: [
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
    synapses: [
      { from: 2, to: 3, weight: 1, type: "positive" },
      { from: 1, to: 3, weight: 1, type: "condition" },
      { from: 0, to: 3, weight: 1, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const network = Creature.fromJSON(json);

  const outNode = network.neurons[3];

  const inNode0 = network.neurons[0];

  const flag0to3 = (inNode0 as Neuron).isProjectingTo(outNode as Neuron);

  assert(flag0to3, "0 -> 3");

  const flag3to0 = (outNode as Neuron).isProjectingTo(inNode0 as Neuron);

  assert(!flag3to0, "3 -> 0 should not be associated");
});
