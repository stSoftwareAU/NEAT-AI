import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";

Deno.test("activate - RELU produces correct clamped output", () => {
  const json: CreatureExport = {
    neurons: [
      { bias: Math.LN2, type: "output", squash: "RELU", uuid: "output-0" },
    ],
    synapses: [
      { weight: Math.E, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -Math.LOG2E, fromUUID: "input-1", toUUID: "output-0" },
      { weight: Math.SQRT1_2, fromUUID: "input-2", toUUID: "output-0" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const b = Math.random() * 4 - 2;
    const c = Math.random() * 4 - 2;

    const data = new Float32Array([a, b, c]);
    const actual = creature.activate(data, false)[0];

    let expected = a * Math.E + b * -Math.LOG2E + c * Math.SQRT1_2 + Math.LN2;
    if (expected < 0) expected = 0;

    assertAlmostEquals(actual, expected, 0.000_005, `iteration ${p}`);
  }
});
