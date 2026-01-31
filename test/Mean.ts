import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import type { CreatureExport } from "../mod.ts";
import { emptyDirSync } from "@std/fs";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;
const testDir = ".test/Mean";
emptyDirSync(testDir);

Deno.test("Mean", () => {
  const json: CreatureExport = {
    neurons: [
      { bias: -0.2, type: "output", squash: "MEAN", uuid: "output-0" },
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
  creature.fix();
  creature.validate();
  Deno.writeTextFileSync(
    `${testDir}/fixed.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;

    const data = new Float32Array([a, b, c]);

    const actual0 = creature.activate(data, false)[0];
    const actual1 = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assertAlmostEquals(actual0, actual1);
    assertAlmostEquals(actual0, actual2);

    const expected = (a + (b * -1) + c) / 3 + -0.2;

    assert(
      Math.abs(expected - actual0) < 0.00001,
      p + ") Expected: " + expected + ", actual: " + actual0 + ", data: " +
        data,
    );
  }
});
