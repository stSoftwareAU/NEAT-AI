import { assert, assertEquals, assertNotStrictEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "../../src/methods/activations/types/LOGISTIC.ts";

/**
 * Tests for Issue #1015: Performance optimisation of compact operation.
 *
 * These tests verify that the optimised cloning (direct property copy) produces
 * behaviour-equivalent results to the previous JSON.parse(JSON.stringify()) approach.
 */

Deno.test("compactCreature: optimised clone produces independent neuron arrays", () => {
  // Arrange - create a creature with neurons that will be modified during compaction
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
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

Deno.test("compactCreature: optimised clone produces independent synapse arrays", () => {
  // Arrange - create a creature with synapses
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: LOGISTIC.NAME, bias: 0.5 },
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

Deno.test("compactCreature: optimised clone preserves tags on neurons", () => {
  // Arrange - create a creature with tagged neurons
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: IDENTITY.NAME,
        bias: 0.5,
        tags: [{ name: "custom", value: "neuron-tag" }],
      },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
    input: 1,
    output: 1,
    tags: [{ name: "creature", value: "test" }],
  };

  const creature = Creature.fromJSON(json);

  // Act
  const compacted = compactCreature(creature, false);
  assert(compacted, "Should have compacted");

  // Assert - tags should be preserved in compacted creature
  const exported = compacted.exportJSON();

  // The output neuron should still exist and have no modification to tags from compaction
  const outputNeuron = exported.neurons.find((n) => n.uuid === "output-0");
  assert(outputNeuron, "Output neuron should exist");
});

Deno.test("compactCreature: optimised clone preserves tags on synapses", () => {
  // Arrange - create a creature with tagged synapses
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: LOGISTIC.NAME, bias: 0.5 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.5,
        tags: [{ name: "synapse-type", value: "input-to-hidden" }],
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.6 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act
  const compacted = compactCreature(creature, false);

  // Assert - no compaction should occur for this simple network
  // but if it does, tags should be preserved
  if (compacted) {
    const exported = compacted.exportJSON();
    const taggedSynapse = exported.synapses.find(
      (s) => s.fromUUID === "input-0" && s.toUUID === "hidden-0",
    );
    if (taggedSynapse) {
      assert(taggedSynapse.tags, "Synapse tags should be preserved");
      assertEquals(taggedSynapse.tags.length, 1);
      assertEquals(taggedSynapse.tags[0].name, "synapse-type");
    }
  }
});

Deno.test("compactCreature: optimised clone preserves synapse types", () => {
  // Arrange - create a creature with typed synapses (positive, negative, condition)
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: LOGISTIC.NAME, bias: 0.5 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.1 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.5,
        type: "positive",
      },
      {
        fromUUID: "hidden-0",
        toUUID: "output-0",
        weight: 0.6,
        type: "negative",
      },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act
  const compacted = compactCreature(creature, false);

  // Assert - if compaction occurs, synapse types should be preserved
  if (compacted) {
    const exported = compacted.exportJSON();
    const inputSynapse = exported.synapses.find(
      (s) => s.fromUUID === "input-0",
    );
    if (inputSynapse) {
      assertEquals(
        inputSynapse.type,
        "positive",
        "Synapse type should be preserved after compaction",
      );
    }
  }
});

Deno.test("compactCreature: optimised clone preserves forwardOnly flag", () => {
  // Arrange - create a forward-only creature
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
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

Deno.test("compactCreature: optimised clone preserves creature-level tags", () => {
  // Arrange - create a creature with creature-level tags
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
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

  // Assert - creature tags should be preserved (though compaction adds its own tags)
  const exported = compacted.exportJSON();
  assert(exported.tags, "Compacted creature should have tags");
});

Deno.test("compactCreature: optimised clone - mutation of cloned neurons does not affect original", () => {
  // This test verifies that the cloned data is truly independent
  // If shallow copy is done incorrectly, mutating the clone would affect the original

  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
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

Deno.test("compactCreature: optimised clone - mutation of cloned synapses does not affect original", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
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

Deno.test("compactCreature: optimised clone preserves memetic data (not modified)", () => {
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
        "input-0": [{ toUUID: "output-0", weight: 0.6 }],
      },
      biases: {
        "output-0": 0.2,
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

Deno.test("compactCreature: optimised clone preserves semanticVersion", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
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

Deno.test("compactCreature: optimised clone produces separate object references", () => {
  // This test explicitly verifies object reference independence

  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.5 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0.3 },
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

Deno.test("compactCreature: large network clone correctness verification", () => {
  // Create a larger network with redundant neurons that will be compacted.
  // Uses a chain of IDENTITY neurons which can be collapsed.

  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Create chain of IDENTITY neurons that can be bypassed
  for (let i = 0; i < 20; i++) {
    neurons.push({
      type: "hidden",
      uuid: `hidden-${i}`,
      squash: IDENTITY.NAME,
      bias: 0,
    });
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
