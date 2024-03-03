import { assert } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";

import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { Mish } from "../src/methods/activations/types/Mish.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Mish", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "Mish", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  };
  const network = Creature.fromJSON(json);
  const activation = new Mish();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;

    const data = [a];
    const actual = network.activateAndTrace(data)[0];
    const actual2 = network.activateAndTrace(data)[0];

    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
    const expected = activation.squash(a);

    if (Math.abs(expected - actual) >= 0.00001) {
      const actual3 = network.activateAndTrace(data)[0];
      console.info(actual3);
    }
    assert(
      Math.abs(expected - actual) < 0.00001,
      p + ") Expected: " + expected + ", actual: " + actual + ", data: " + data,
    );
  }
});
