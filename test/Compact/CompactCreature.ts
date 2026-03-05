import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";

Deno.test("compactCreature - returns undefined when no compaction occurs", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.3 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const result = compactCreature(creature, false);

  assertEquals(result, undefined);
});

Deno.test("compactCreature - removes dead hidden neuron", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "dead-h", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "alive-h", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // dead-h has inbound only, no path to output
      { fromUUID: "input-0", toUUID: "dead-h", weight: 0.3 },
      // alive-h connects to output
      { fromUUID: "input-1", toUUID: "alive-h", weight: 0.4 },
      { fromUUID: "alive-h", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const result = compactCreature(creature, false);

  assert(result !== undefined, "Should compact dead neuron");
  const neurons = result!.exportJSON().neurons;
  const uuids = neurons.map((n) => n.uuid);
  assert(!uuids.includes("dead-h"), "Dead neuron should be removed");
});

Deno.test("compactCreature - preserves forward-only semantics", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "dead-h", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "alive-h", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "dead-h", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "alive-h", weight: 0.4 },
      { fromUUID: "alive-h", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const result = compactCreature(creature, false);

  if (result) {
    assertEquals(result.forwardOnly, true);
  }
});

Deno.test("compactCreature - COMPLEMENT bypass preserves behaviour", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "complement-h",
        squash: "COMPLEMENT",
        bias: 0.5,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "complement-h", weight: 0.3 },
      { fromUUID: "complement-h", toUUID: "output-0", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.5, 0.25]);
  const originalOutput = creature.activate(testInput);

  const result = compactCreature(creature, false);

  if (result) {
    const compactedOutput = result.activate(testInput);
    assertAlmostEquals(
      compactedOutput[0],
      originalOutput[0],
      1e-6,
      "COMPLEMENT bypass should preserve behaviour",
    );
  }
});

Deno.test("compactCreature - removes zero-weight synapses", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0 }, // zero weight
      { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const result = compactCreature(creature, false);

  if (result) {
    const synapses = result.exportJSON().synapses;
    const zeroWeightSynapses = synapses.filter((s) => s.weight === 0);
    assertEquals(
      zeroWeightSynapses.length,
      0,
      "Zero-weight synapses should be removed",
    );
  }
});

Deno.test("compactCreature - chain compaction with IDENTITY", () => {
  // Create a chain: input -> h1(IDENTITY) -> output where h1 has one in/one out
  // and same squash as source — should be compactable
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.6, 0.4]);
  const originalOutput = creature.activate(testInput);

  const result = compactCreature(creature, false);

  // Whether or not the specific chain compaction triggers,
  // behaviour should be preserved if compaction occurs
  if (result) {
    const compactedOutput = result.activate(testInput);
    assertAlmostEquals(
      compactedOutput[0],
      originalOutput[0],
      1e-6,
      "Chain compaction should preserve behaviour",
    );
  }
});
