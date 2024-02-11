import { assert } from "https://deno.land/std@0.215.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";

import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

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
  const network = Creature.fromJSON(json);

  const connects = network.toConnections(3);

  assert(connects.length == 3, "expected 3 got " + connects.length);

  const connects2 = network.toConnections(3);

  assert(connects2.length == 3, "expected 3 got " + connects2.length);

  network.addNode();

  let foundPositive = false;
  let foundNegative = false;
  let foundCondition = false;
  network.synapses.forEach((c) => {
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
  const connects4 = network.toConnections(4);

  assert(connects4.length >= 3, "expected at least 3 got " + connects4.length);

  // const to3 = network.util.toConnections(3);

  // assert(to3.length == 1, "expected 1 got " + to3.length);

  // const from3 = network.util.fromConnections(3);

  // assert(from3.length == 1, "expected 1 got " + from3.length);
});
