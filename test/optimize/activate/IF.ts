import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

Deno.test("activate - IF squash with condition/positive/negative branches executes correctly", () => {
  const json: CreatureExport = {
    neurons: [
      { bias: -Math.LN10, type: "hidden", squash: "IF", uuid: "hidden-0" },
      { bias: Math.SQRT2, type: "output", squash: "TANH", uuid: "output-0" },
    ],
    synapses: [
      {
        weight: Math.LOG10E,
        fromUUID: "input-0",
        toUUID: "hidden-0",
        type: "condition",
      },
      { weight: -1, fromUUID: "input-1", toUUID: "hidden-0", type: "positive" },
      { weight: 1, fromUUID: "input-2", toUUID: "hidden-0", type: "negative" },
      {
        weight: Math.E,
        fromUUID: "input-3",
        toUUID: "hidden-0",
        type: "negative",
      },
      {
        weight: -Math.SQRT1_2,
        fromUUID: "input-4",
        toUUID: "hidden-0",
        type: "condition",
      },
      {
        weight: -Math.SQRT2,
        fromUUID: "input-5",
        toUUID: "hidden-0",
        type: "condition",
      },
      { weight: Math.PI, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 6,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const b = Math.random() * 4 - 2;
    const c = Math.random() * 4 - 2;
    const d = Math.random() * 4 - 2;
    const e = Math.random() * 4 - 2;
    const f = Math.random() * 4 - 2;

    const data = new Float32Array([a, b, c, d, e, f]);
    const actual0 = creature.activate(data, false)[0];

    const actual1 = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assertAlmostEquals(actual0, actual1);
    assertAlmostEquals(actual0, actual2);
    assert(
      Math.abs(actual0 - actual2) < 0.000_000_1,
      "repeated calls should return the same result",
    );
    const condition = a * Math.LOG10E + e * -Math.SQRT1_2 + f * -Math.SQRT2;
    const hidden = (condition > 0 ? b * -1 : (c + d * Math.E)) - Math.LN10;
    const expected = Math.tanh(hidden * Math.PI + Math.SQRT2);

    // Tolerance relaxed from 1e-6 to 2e-6 to accommodate f32 precision in WASM activation.
    assertAlmostEquals(expected, actual0, 0.000_002, `iteration ${p}`);
  }
});
