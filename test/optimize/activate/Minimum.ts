import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

Deno.test("activate - MINIMUM squash selects lowest weighted input", () => {
  const directory = ".test/optimize/activate/Minimum";
  Deno.mkdirSync(directory, { recursive: true });
  const json: CreatureExport = {
    neurons: [
      { bias: -Math.E, type: "output", squash: "MINIMUM", uuid: "output-0" },
    ],
    synapses: [
      { weight: Math.LN10, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -Math.LN2, fromUUID: "input-1", toUUID: "output-0" },
      { weight: Math.LOG10E, fromUUID: "input-2", toUUID: "output-0" },
      { weight: -Math.LOG2E, fromUUID: "input-3", toUUID: "output-0" },
      { weight: Math.PI, fromUUID: "input-4", toUUID: "output-0" },
    ],
    input: 5,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const exportCreature = creature.exportInternalJSON();
  Deno.writeTextFileSync(
    `${directory}/creature.json`,
    JSON.stringify(exportCreature, null, 1),
  );

  const sparseConfig = new SparseConfig(
    exportCreature,
    createBackPropagationConfig({}),
  );

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const b = Math.random() * 4 - 2;
    const c = Math.random() * 4 - 2;
    const d = Math.random() * 4 - 2;
    const e = Math.random() * 4 - 2;

    const data = new Float32Array([a, b, c, d, e]);
    const actual0 = creature.activate(data, false)[0];

    const actual1 = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assertAlmostEquals(
      actual0,
      actual1,
      0.000_000_01,
      "activate vs activateAndTrace must agree",
    );
    assertAlmostEquals(
      actual0,
      actual2,
      0.000_000_01,
      "repeated activateAndTrace calls must be deterministic",
    );

    const expected = Math.min(
      a * Math.LN10,
      b * -Math.LN2,
      c * Math.LOG10E,
      d * -Math.LOG2E,
      e * Math.PI,
    ) - Math.E;

    assertAlmostEquals(expected, actual0, 0.000_001, `iteration ${p}`);
  }
});
