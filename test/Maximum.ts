import { assert } from "@std/assert";
import { Creature } from "../src/Creature.ts";

import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Maximum", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "MAXIMUM", index: 3 },
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

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;

    const data = [a, b, c];
    const actual = network.activateAndTrace(data)[0];
    const actual2 = network.activateAndTrace(data)[0];

    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
    const expected = Math.max(a, b, c);

    assert(
      Math.abs(expected - actual) < 0.00001,
      p + ") Expected: " + expected + ", actual: " + actual + ", data: " + data,
    );
  }
});

Deno.test("Maximum-fix", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "MAXIMUM", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const network = Creature.fromJSON(json);

  network.fix();
  const toList = network.inwardConnections(3);

  assert(
    toList.length >= 1,
    "should have corrected number of connection was: " + toList.length,
  );
});
