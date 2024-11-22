import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import { Upgrade } from "../src/reconstruct/Upgrade.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("correctExport", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "IDENTITY", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const json2 = Upgrade.correct(Creature.fromJSON(json).exportJSON(), 5);
  const creature = Creature.fromJSON(json2);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;

    const data = new Float32Array([a, b, c, a + b, b + c]);
    const actual = creature.activateAndTrace(data, false, sparseConfig)[0];

    assertAlmostEquals(actual, a + b + c, 0.00001);
  }
});
