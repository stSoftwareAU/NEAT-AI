import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { mergeDuplicateSynapses } from "../../src/compact/CompactUtils.ts";
import { ValidationError } from "@errors/ValidationError.ts";
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
      { fromUUID: "input-0", toId: -1, weight: 0.5 },
      { fromUUID: "input-0", toId: -1, weight: -0.1 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json, false);
  (creature as unknown as { memetic?: unknown }).memetic = { note: "test" };
  return creature;
}

Deno.test("fix(): throws DUPLICATE_SYNAPSE when duplicate (from,to) rows exist", async () => {
  await initWasmForTests();
  const creature = makeCreature();

  const err = assertThrows(
    () => creature.fix(),
    ValidationError,
    "Duplicate synapse endpoints",
  ) as ValidationError;
  assertEquals(err.reason, "DUPLICATE_SYNAPSE");
});

Deno.test(
  "mergeDuplicateSynapses on export then fix() restores single row (legacy recovery)",
  async () => {
    await initWasmForTests();
    const json: CreatureExport = {
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.25 },
      ],
      synapses: [
        { fromUUID: "input-0", toId: -1, weight: 0.5 },
        { fromUUID: "input-0", toId: -1, weight: -0.1 },
      ],
      input: 1,
      output: 1,
    };

    mergeDuplicateSynapses(json);
    const creature = Creature.fromJSON(json, false);

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

    for (let i = 0; i < inputs.length; i++) {
      const after = creature.activate(inputs[i])[0];
      assertAlmostEquals(after, before[i], 0.000_000_1);
    }
  },
);

Deno.test(
  "mergeDuplicateSynapses coalesces same (from,to) with different type before load",
  async () => {
    await initWasmForTests();
    const json: CreatureExport = {
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toId: -1, weight: 0.1 },
        { fromUUID: "input-0", toId: -1, weight: 0.2, type: "positive" },
      ],
      input: 1,
      output: 1,
    };

    mergeDuplicateSynapses(json);
    const creature = Creature.fromJSON(json, false);
    creature.fix();
    creature.validate();

    assertEquals(creature.synapses.length, 1);
    assertAlmostEquals(creature.synapses[0].weight, 0.3, 0.000_000_1);
    assertEquals(creature.synapses[0].type, undefined);
  },
);
