import { assert } from "@std/assert";
import { Creature } from "../src/Creature.ts";

import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { AddNeuron } from "../src/mutate/AddNeuron.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("inward", () => {
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
  const creature = Creature.fromJSON(json);

  const connects = creature.inwardConnections(3);

  assert(connects.length == 3, "expected 3 got " + connects.length);

  const connects2 = creature.inwardConnections(3);

  assert(connects2.length == 3, "expected 3 got " + connects2.length);

  const addNeuron = new AddNeuron(creature);
  addNeuron.mutate();

  let foundPositive = false;
  let foundNegative = false;
  let foundCondition = false;
  creature.synapses.forEach((c) => {
    if (c.type == "positive") {
      foundPositive = true;
    } else if (c.type == "condition") {
      foundCondition = true;
    } else if (c.type == "negative") {
      foundNegative = true;
    }
  });

  assert(foundPositive, "should have found a positive link");

  assert(foundNegative, "should have found a negative link");

  assert(foundCondition, "should have found a condition link");
  const connects4 = creature.inwardConnections(4);

  assert(connects4.length >= 3, "expected at least 3 got " + connects4.length);
});
