import { assert, assertAlmostEquals, fail } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";
import { initWasmActivation } from "../../../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Maximum", async () => {
  const directory = ".test/optimize/activate/Maximum";
  await initWasmActivation();
  await Deno.mkdir(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      { bias: -0.2, type: "output", squash: "MAXIMUM", uuid: "output-0" },
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
  await Deno.writeTextFile(
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

    assertAlmostEquals(actual0, actual1);
    assertAlmostEquals(actual0, actual2);
    assert(
      Math.abs(actual0 - actual2) < 0.000_000_1,
      "repeated calls should return the same result",
    );
    const expected = Math.max(a, b * -1, c) - 0.2;

    const delta = expected - actual0;
    if (Math.abs(delta) > 0.000_0002) {
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
