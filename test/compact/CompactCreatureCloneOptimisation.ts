import { assert, assertEquals, assertNotStrictEquals } from "@std/assert";
import { Creature } from "@creature";
import { compactCreature } from "@compact/CompactCreature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";

/**
 * Tests that compaction produces behaviour-equivalent results without
 * corrupting the original creature, and that metadata (tags, flags,
 * semantic version, memetic data) is preserved through compaction.
 */

Deno.test("compactCreature: compaction does not modify original creature neurons", () => {
  // Arrange - create a creature with neurons that will be modified during compaction
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const originalExport = creature.exportJSON();
  const originalNeuronCount = originalExport.neurons.length;

  // Act - compact should create an independent copy
  // Compaction result is not used, but ensures the cloning code path executes
  compactCreature(creature, false);

  // Assert - original creature's export should be unchanged
  const afterExport = creature.exportJSON();
  assertEquals(
    afterExport.neurons.length,
    originalNeuronCount,
    "Original creature should not be modified during compaction",
  );
});

Deno.test("compactCreature: compaction does not modify original creature synapses", () => {
  // Arrange - create a creature with synapses
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: LOGISTIC.NAME,
        bias: 0.5,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.6 },
      // Backward synapse that will be removed without feedbackLoop
      { fromUUID: "output-0", toUUID: "hidden-0", weight: 0.3 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const originalExport = creature.exportJSON();
  const originalSynapseCount = originalExport.synapses.length;

  // Act - compact without feedback loop should remove backward synapse
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - original creature's export should be unchanged
  const afterExport = creature.exportJSON();
  assertEquals(
    afterExport.synapses.length,
    originalSynapseCount,
    "Original creature's synapse array should not be modified during compaction",
  );
});

Deno.test("compactCreature: preserves neuron tags through compaction", () => {
  // Arrange - create a creature with a backward synapse and a tagged hidden neuron.
  // Compacting with feedbackLoop=false strips the backward synapse, triggering
  // compaction. The tagged hidden neuron (hidden-0) remains live and should
  // retain its tags.
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: LOGISTIC.NAME,
        bias: 0.5,
        tags: [{ name: "custom", value: "neuron-tag" }],
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      // Backward synapse that will be removed when feedbackLoop=false
      { fromUUID: "output-0", toUUID: "hidden-0", weight: 0.3 },
    ],
    input: 1,
    output: 1,
    tags: [{ name: "creature", value: "test" }],
  };

  const creature = Creature.fromJSON(json);

  // Act - compact with feedbackLoop=false strips backward synapse
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted (backward synapse removed)");

  // Assert - the tagged neuron should survive and retain its tags
  const exported = compacted.exportJSON();
  const taggedNeuron = exported.neurons.find((n) => n.uuid === "hidden-0");
  assert(taggedNeuron, "Tagged neuron should survive compaction");
  assert(taggedNeuron.tags, "Neuron tags should be preserved");
  assertEquals(taggedNeuron.tags.length, 1);
  assertEquals(taggedNeuron.tags[0].name, "custom");
  assertEquals(taggedNeuron.tags[0].value, "neuron-tag");
});

Deno.test("compactCreature: preserves synapse tags through compaction", () => {
  // Arrange - use an IDENTITY chain (hidden-0 -> hidden-1) that compacts,
  // with a tagged synapse on input->hidden-0 that survives compaction
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.5,
        tags: [{ name: "synapse-type", value: "input-to-hidden" }],
      },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act - IDENTITY chain should compact
  const compacted = compactCreature(creature, false);
  assert(compacted, "Network with IDENTITY chain should compact");

  // Assert - tagged synapse should be preserved
  const exported = compacted.exportJSON();
  const taggedSynapse = exported.synapses.find(
    (s) => s.fromUUID === "input-0" && s.toUUID === "hidden-0",
  );
  assert(taggedSynapse, "Input synapse should exist after compaction");
  assert(taggedSynapse.tags, "Synapse tags should be preserved");
  assertEquals(taggedSynapse.tags.length, 1);
  assertEquals(taggedSynapse.tags[0].name, "synapse-type");
});

Deno.test("compactCreature: preserves synapse types through compaction", () => {
  // Arrange - use an IDENTITY chain that compacts, with typed synapses
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.5,
        type: "positive",
      },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act - IDENTITY chain should compact
  const compacted = compactCreature(creature, false);
  assert(compacted, "Network with IDENTITY chain should compact");

  // Assert - synapse type should be preserved
  const exported = compacted.exportJSON();
  const inputSynapse = exported.synapses.find(
    (s) => s.fromUUID === "input-0" && s.toUUID === "hidden-0",
  );
  assert(inputSynapse, "Input synapse should exist after compaction");
  assertEquals(
    inputSynapse.type,
    "positive",
    "Synapse type should be preserved after compaction",
  );
});

Deno.test("compactCreature: preserves forwardOnly flag through compaction", () => {
  // Arrange - create a forward-only creature
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
    forwardOnly: true,
  };

  const creature = Creature.fromJSON(json);

  // Act
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - forwardOnly should be preserved
  const exported = compacted.exportJSON();
  assertEquals(
    exported.forwardOnly,
    true,
    "forwardOnly flag should be preserved after compaction",
  );
});

Deno.test("compactCreature: preserves creature-level tags after compaction", () => {
  // Arrange - create a creature with creature-level tags
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
    tags: [
      { name: "model-version", value: "1.0.0" },
      { name: "training-run", value: "experiment-42" },
    ],
  };

  const creature = Creature.fromJSON(json);

  // Act
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - original creature tags should be preserved in the compacted result
  const exported = compacted.exportJSON();
  assert(exported.tags, "Compacted creature should have tags");

  const modelTag = exported.tags.find((t) => t.name === "model-version");
  assert(modelTag, "model-version tag should be preserved");
  assertEquals(modelTag.value, "1.0.0");

  const runTag = exported.tags.find((t) => t.name === "training-run");
  assert(runTag, "training-run tag should be preserved");
  assertEquals(runTag.value, "experiment-42");
});

Deno.test("compactCreature: compacting does not mutate original neuron biases", () => {
  // This test verifies that the cloned data is truly independent
  // If shallow copy is done incorrectly, mutating the clone would affect the original

  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const originalBias = creature.exportJSON().neurons[2].bias; // output-0 bias

  // Act - compact will modify the cloned neurons (e.g., bias adjustments)
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - original creature should not be affected
  const afterBias = creature.exportJSON().neurons[2].bias;
  assertEquals(
    afterBias,
    originalBias,
    "Original creature's neuron bias should not be modified by compaction",
  );
});

Deno.test("compactCreature: compacting does not mutate original synapse weights", () => {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const originalWeight = creature.exportJSON().synapses[0].weight;

  // Act
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - original creature should not be affected
  const afterWeight = creature.exportJSON().synapses[0].weight;
  assertEquals(
    afterWeight,
    originalWeight,
    "Original creature's synapse weight should not be modified by compaction",
  );
});

Deno.test("compactCreature: preserves memetic data when no compaction occurs", () => {
  // Note: Compaction deletes memetic data intentionally when changes occur,
  // but the clone itself should preserve it if no changes are made

  const json: CreatureExport = {
    neurons: [
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.5 }],
    input: 1,
    output: 1,
    memetic: {
      generation: 5,
      weights: {
        [0]: [{ toId: -1, weight: 0.6 }],
      },
      biases: {
        [-1]: 0.2,
      },
      score: 0.95,
    },
  };

  const creature = Creature.fromJSON(json);

  // Act - this simple network should not compact (no redundant neurons)
  const compacted = compactCreature(creature, false);

  // Assert - no compaction should occur, so memetic should remain untouched
  assertEquals(
    compacted,
    undefined,
    "Simple network with no redundancy should not compact",
  );

  // Original memetic should be unchanged
  const exported = creature.exportJSON();
  assert(exported.memetic, "Original memetic data should exist");
  assertEquals(exported.memetic.generation, 5);
});

Deno.test("compactCreature: preserves semanticVersion through compaction", () => {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
    semanticVersion: "1.2.3",
  };

  const creature = Creature.fromJSON(json);

  // Act
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - semanticVersion should be preserved
  const exported = compacted.exportJSON();
  assertEquals(
    exported.semanticVersion,
    "1.2.3",
    "semanticVersion should be preserved after compaction",
  );
});

Deno.test("compactCreature: compacted creature is a separate object from original", () => {
  // This test explicitly verifies object reference independence

  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: IDENTITY.NAME,
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: IDENTITY.NAME,
        bias: 0.3,
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const originalExport = creature.exportJSON();

  // Act
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - exported arrays should be different object references
  const compactedExport = compacted.exportJSON();

  assertNotStrictEquals(
    originalExport.neurons,
    compactedExport.neurons,
    "Neuron arrays should be different objects",
  );

  assertNotStrictEquals(
    originalExport.synapses,
    compactedExport.synapses,
    "Synapse arrays should be different objects",
  );
});

Deno.test("compactCreature: large IDENTITY chain compacts without corrupting original", () => {
  // Create a larger network with redundant neurons that will be compacted.
  // Uses a chain of IDENTITY neurons which can be collapsed.

  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Create chain of IDENTITY neurons that can be bypassed
  for (let i = 0; i < 20; i++) {
    const neuron = {
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      squash: IDENTITY.NAME,
      bias: 0,
      ...(i === 0 ? { id: 5000 } : {}),
    };
    neurons.push(neuron);
  }

  // Add output neuron
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: IDENTITY.NAME,
    bias: 0.1,
  });

  // Create synapses in a chain pattern that allows compaction
  synapses.push({
    fromUUID: "input-0",
    toUUID: "hidden-0",
    weight: 1.0,
  });

  for (let i = 0; i < 19; i++) {
    synapses.push({
      fromUUID: `hidden-${i}`,
      toUUID: `hidden-${i + 1}`,
      weight: 1.0,
    });
  }

  synapses.push({
    fromUUID: "hidden-19",
    toUUID: "output-0",
    weight: 1.0,
  });

  const json: CreatureExport = {
    neurons,
    synapses,
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  const originalNeuronCount = creature.exportJSON().neurons.length;

  // Act - IDENTITY chain should compact
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted chain of IDENTITY neurons");

  // Assert - compacted network should be valid
  compacted.validate();

  // Compacted should have fewer neurons
  const compactedExport = compacted.exportJSON();
  assert(
    compactedExport.neurons.length < originalNeuronCount,
    "Compaction should reduce neuron count",
  );

  // Original should be unchanged
  const afterExport = creature.exportJSON();
  assertEquals(
    afterExport.neurons.length,
    originalNeuronCount,
    "Original neuron count should be unchanged after compaction",
  );
});
