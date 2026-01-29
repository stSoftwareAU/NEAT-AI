import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { initWasmForTests } from "../_initWasm.ts";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.25 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      // Duplicate (same from/to). This should be merged, not dropped.
      { fromUUID: "input-0", toUUID: "output-0", weight: -0.1 },
    ],
    input: 1,
    output: 1,
  };

  // Note: validate=false is intentional. Real-world exports can be edited and end
  // up containing duplicate synapses, which validation currently rejects.
  const creature = Creature.fromJSON(json, false);
  // Simulate a persisted memetic record that should be dropped when structure changes.
  (creature as unknown as { memetic?: unknown }).memetic = { note: "test" };
  return creature;
}

Deno.test("fix(): merges duplicate synapses by summing weights (behaviour-preserving)", async () => {
  await initWasmForTests();
  const creature = makeCreature();

  const rnd = mulberry32(20251229);
  const inputs: Float32Array[] = [];
  for (let i = 0; i < 256; i++) {
    inputs.push(new Float32Array([(rnd() * 2 - 1) * 1.1]));
  }

  const before = inputs.map((x) => creature.activate(x)[0]);

  creature.fix();
  creature.validate();

  assertEquals(creature.synapses.length, 1);
  assertAlmostEquals(creature.synapses[0].weight, 0.4, 0.000_000_1);
  assertEquals(
    (creature as unknown as { memetic?: unknown }).memetic,
    undefined,
  );

  for (let i = 0; i < inputs.length; i++) {
    const after = creature.activate(inputs[i])[0];
    assertAlmostEquals(after, before[i], 0.000_000_1);
  }
});
