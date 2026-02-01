import { assert, assertAlmostEquals, fail } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Constant", () => {
  const directory = ".test/optimize/activate/Constant";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      { bias: Math.PI, type: "constant", uuid: "pie" },
      { bias: Math.LN2, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: Math.E, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -Math.LOG2E, fromUUID: "input-1", toUUID: "output-0" },
      { weight: Math.SQRT1_2, fromUUID: "input-2", toUUID: "output-0" },
      { weight: 2, fromUUID: "pie", toUUID: "output-0" },
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
    const a = Math.random() * 4 - 2;
    const b = Math.random() * 4 - 2;
    const c = Math.random() * 4 - 2;

    const data = new Float32Array([a, b, c]);
    const actual0 = creature.activate(data, false)[0];

    const actual1 = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assertAlmostEquals(actual0, actual1, 0.000_002);
    assertAlmostEquals(actual1, actual2, 0.000_002);
    assert(
      Math.abs(actual0 - actual2) < 0.000_002,
      "repeated calls should return the same result",
    );
    const expected = a * Math.E + b * -Math.LOG2E + c * Math.SQRT1_2 +
      Math.PI * 2 + Math.LN2;

    const delta = expected - actual0;
    if (Math.abs(delta) > 0.000_005) {
      console.info(
        "Expected: " + expected + ", actual: " + actual0 + ", delta: ",
        delta,
        data,
      );
      fail(
        p + ") Expected: " + expected + ", actual: " + actual0 + ", delta: " +
          delta,
      );
    }
  }
});

Deno.test("Constant-max", () => {
  const directory = ".test/optimize/activate/Constant-max";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      { bias: Math.PI, type: "constant", uuid: "pie" },
      { bias: Math.LN2, type: "output", squash: "MAXIMUM", uuid: "output-0" },
    ],
    synapses: [
      { weight: Math.E, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -Math.LOG2E, fromUUID: "input-1", toUUID: "output-0" },
      { weight: Math.SQRT1_2, fromUUID: "input-2", toUUID: "output-0" },
      { weight: 2, fromUUID: "pie", toUUID: "output-0" },
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
    const a = Math.random() * 4 - 2;
    const b = Math.random() * 4 - 2;
    const c = Math.random() * 4 - 2;

    const data = new Float32Array([a, b, c]);
    const actual0 = creature.activate(data, false)[0];

    const actual1 = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assertAlmostEquals(actual0, actual1, 0.000_001);
    assertAlmostEquals(actual1, actual2);
    assert(
      Math.abs(actual0 - actual2) < 0.000_001,
      "repeated calls should return the same result",
    );
    const expected =
      Math.max(a * Math.E, b * -Math.LOG2E, c * Math.SQRT1_2, Math.PI * 2) +
      Math.LN2;

    const delta = expected - actual0;
    if (Math.abs(delta) > 0.000_005) {
      console.info(
        "Expected: " + expected + ", actual: " + actual0 + ", delta: ",
        delta,
        data,
      );
      fail(
        p + ") Expected: " + expected + ", actual: " + actual0 + ", delta: " +
          delta,
      );
    }
  }
});
