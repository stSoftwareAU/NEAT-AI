import { assert } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("CLIPPED", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "CLIPPED", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;

    const data = new Float32Array([a]);
    const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
    const expected = Math.max(-1, Math.min(1, a));

    assert(
      Math.abs(expected - actual) < 0.00001,
      p + ") Expected: " + expected + ", actual: " + actual + ", data: " + data,
    );
  }
});
