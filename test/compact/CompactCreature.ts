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
  // After compaction, the dead hidden neuron should be removed
  assert(
    neurons.every((n) => n.type === "output"),
    "Dead neuron should be removed",
  );
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

  assert(
    result !== undefined,
    "Should compact dead neuron in forward-only creature",
  );
  assertEquals(result.forwardOnly, true);
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

  assert(result !== undefined, "Should compact COMPLEMENT neuron");
  const compactedOutput = result.activate(testInput);
  assertAlmostEquals(
    compactedOutput[0],
    originalOutput[0],
    1e-6,
    "COMPLEMENT bypass should preserve behaviour",
  );
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

  assert(
    result !== undefined,
    "Should compact creature with zero-weight synapse",
  );
  const synapses = result.exportJSON().synapses;
  const zeroWeightSynapses = synapses.filter((s) => s.weight === 0);
  assertEquals(
    zeroWeightSynapses.length,
    0,
    "Zero-weight synapses should be removed",
  );
});

Deno.test("compactCreature - IDENTITY chain between two same-squash neurons merges into direct synapse", () => {
  // Chain compaction requires neuron.squash === fromNeuron.squash, so we chain
  // two IDENTITY hidden neurons: h1 -> h2 -> output. h2 has one inbound
  // (from h1) and one outbound (to output), so it can be bypassed.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.8 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const testInput = new Float32Array([0.6]);
  const originalOutput = creature.activate(testInput);

  const result = compactCreature(creature, false);

  assert(
    result !== undefined,
    "Should compact IDENTITY chain (h1 -> h2 -> output with matching squash)",
  );
  result.validate();
  const compactedOutput = result.activate(testInput);
  assertAlmostEquals(
    compactedOutput[0],
    originalOutput[0],
    1e-6,
    "Chain compaction should preserve behaviour",
  );
});
