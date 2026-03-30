import { assert } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { ELU } from "@methods/activations/types/ELU.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ELU", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "ELU", index: 3 },
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
  const activation = new ELU();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;

    const data = [a];
    const actual =
      creature.activateAndTrace(new Float32Array(data), false, sparseConfig)[0];
    const actual2 =
      creature.activateAndTrace(new Float32Array(data), false, sparseConfig)[0];

    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
    const expected = activation.squash(a);

    assert(
      Math.abs(expected - actual) < 0.00001,
      p + ") Expected: " + expected + ", actual: " + actual + ", data: " + data,
    );
  }
});
