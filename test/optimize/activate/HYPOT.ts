import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

Deno.test("activate - HYPOT squash produces correct hypotenuse output", () => {
  const directory = ".test/optimize/activate/HYPOT";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      { bias: -0.2, type: "output", squash: "HYPOT", uuid: "output-0" },
    ],
    synapses: [
      { weight: 1, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -1, fromUUID: "input-1", toUUID: "output-0" },
      { weight: 1, fromUUID: "input-2", toUUID: "output-0" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const exportCreature = creature.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/creature.json`,
    JSON.stringify(exportCreature, null, 1),
  );

  const sparseConfig = new SparseConfig(
    exportCreature,
    createBackPropagationConfig({}),
  );

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 3 - 1.5;
    const b = Math.random() * 3 - 1.5;
    const c = Math.random() * 3 - 1.5;

    const data = new Float32Array([a, b, c]);
    const actual0 = creature.activate(data, false)[0];

    const actual1 = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assertAlmostEquals(
      actual0,
      actual1,
      0.000_000_1,
      "activate vs activateAndTrace must agree",
    );
    assertAlmostEquals(
      actual0,
      actual2,
      0.000_000_1,
      "repeated activateAndTrace calls must be deterministic",
    );

    const expected = Math.hypot(a, b * -1, c) - 0.2;
    assertAlmostEquals(
      expected,
      actual0,
      0.000_000_5,
      `iteration ${p}: HYPOT output mismatch`,
    );
  }
});
