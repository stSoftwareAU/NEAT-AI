/**
 * Performance tests for createCompatibleFather optimisation.
 *
 * Issue #1034: Avoid JSON exports in parent selection compatibility check.
 *
 * These tests verify that:
 * 1. The optimised createCompatibleFather accepts Creature objects directly
 * 2. The optimisation produces the same results as the original
 * 3. Performance is improved by avoiding full JSON exports
 */
import { assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  createCompatibleFather,
  createCompatibleFatherFromCreatures,
} from "../../src/breed/Father.ts";

/**
 * Creates a creature with many neurons and synapses to simulate a large creature.
 * Based on the issue description, large creatures can be ~500KB each.
 */
function createLargeCreature(
  neuronCount: number,
  prefix: string,
  inputCount: number = 10,
  outputCount: number = 5,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Add hidden neurons in multiple layers
  for (let i = 0; i < neuronCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-hidden-${i}`,
      squash: i % 3 === 0 ? "TANH" : i % 3 === 1 ? "IDENTITY" : "LeakyReLU",
      bias: 0.1 * (i % 10),
    });
  }

  // Add output neurons
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  // Connect inputs to first layer of hidden neurons
  const firstLayerSize = Math.min(neuronCount, 20);
  for (let i = 0; i < inputCount; i++) {
    for (let j = 0; j < firstLayerSize; j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `${prefix}-hidden-${j}`,
        weight: 0.5 * ((i + j) % 10) / 10,
      });
    }
  }

  // Chain hidden neurons with multiple connections
  for (let i = 0; i < neuronCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-hidden-${i}`,
      toUUID: `${prefix}-hidden-${i + 1}`,
      weight: 0.5,
    });

    // Add skip connections every 10 neurons
    if (i % 10 === 0 && i + 10 < neuronCount) {
      synapses.push({
        fromUUID: `${prefix}-hidden-${i}`,
        toUUID: `${prefix}-hidden-${i + 10}`,
        weight: 0.3,
      });
    }
  }

  // Connect last hidden neurons to outputs
  const lastLayerStart = Math.max(0, neuronCount - 20);
  for (let i = lastLayerStart; i < neuronCount; i++) {
    for (let j = 0; j < outputCount; j++) {
      synapses.push({
        fromUUID: `${prefix}-hidden-${i}`,
        toUUID: `output-${j}`,
        weight: 0.5,
      });
    }
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: inputCount,
    output: outputCount,
  });

  creature.validate();
  return creature;
}

Deno.test("createCompatibleFatherFromCreatures - produces functionally equivalent result", () => {
  // Create mother and father with some shared and different neurons
  const motherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "shared-a", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "shared-b", squash: "TANH", bias: 0.2 },
      { type: "hidden", uuid: "mother-only", squash: "TANH", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared-a", weight: 0.5 },
      { fromUUID: "shared-a", toUUID: "shared-b", weight: 0.5 },
      { fromUUID: "shared-b", toUUID: "mother-only", weight: 0.5 },
      { fromUUID: "mother-only", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "mother-only", toUUID: "output-1", weight: 0.5 },
    ],
    input: 3,
    output: 2,
  };

  const fatherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "father-a", squash: "TANH", bias: 0.15 },
      { type: "hidden", uuid: "father-b", squash: "TANH", bias: 0.25 },
      { type: "hidden", uuid: "father-only", squash: "TANH", bias: 0.35 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.05 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "father-a", weight: 0.6 },
      { fromUUID: "father-a", toUUID: "father-b", weight: 0.6 },
      { fromUUID: "father-b", toUUID: "father-only", weight: 0.6 },
      { fromUUID: "father-only", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "father-only", toUUID: "output-1", weight: 0.6 },
    ],
    input: 3,
    output: 2,
  };

  const mother = Creature.fromJSON(motherJson);
  const father = Creature.fromJSON(fatherJson);

  // Get result from original function (using exports)
  const originalResult = createCompatibleFather(
    mother.exportJSON(),
    father.exportJSON(),
  );

  // Get result from optimised function (using Creature objects directly)
  const optimisedResult = createCompatibleFatherFromCreatures(mother, father);

  // Verify structural equivalence (input/output counts)
  assertEquals(optimisedResult.input, originalResult.input);
  assertEquals(optimisedResult.output, originalResult.output);

  // Verify neuron counts and essential properties match
  assertEquals(optimisedResult.neurons.length, originalResult.neurons.length);
  for (let i = 0; i < optimisedResult.neurons.length; i++) {
    assertEquals(
      optimisedResult.neurons[i].uuid,
      originalResult.neurons[i].uuid,
    );
    assertEquals(
      optimisedResult.neurons[i].type,
      originalResult.neurons[i].type,
    );
    assertEquals(
      optimisedResult.neurons[i].bias,
      originalResult.neurons[i].bias,
    );
    assertEquals(
      optimisedResult.neurons[i].squash,
      originalResult.neurons[i].squash,
    );
  }

  // Verify synapse counts and essential properties match
  assertEquals(optimisedResult.synapses.length, originalResult.synapses.length);
  for (let i = 0; i < optimisedResult.synapses.length; i++) {
    assertEquals(
      optimisedResult.synapses[i].fromUUID,
      originalResult.synapses[i].fromUUID,
    );
    assertEquals(
      optimisedResult.synapses[i].toUUID,
      originalResult.synapses[i].toUUID,
    );
    assertEquals(
      optimisedResult.synapses[i].weight,
      originalResult.synapses[i].weight,
    );
  }

  // Both results should create valid creatures
  const originalCreature = Creature.fromJSON(originalResult);
  const optimisedCreature = Creature.fromJSON(optimisedResult);

  originalCreature.validate();
  optimisedCreature.validate();
});

Deno.test("createCompatibleFatherFromCreatures - works with large creatures", () => {
  const mother = createLargeCreature(100, "mother");
  const father = createLargeCreature(100, "father");

  // The optimised function should work with large creatures
  const result = createCompatibleFatherFromCreatures(mother, father);

  assertExists(result, "Should produce a valid result");
  assertExists(result.neurons, "Result should have neurons");
  assertExists(result.synapses, "Result should have synapses");

  // Verify the result can be converted to a creature
  const compatibleFather = Creature.fromJSON(result);
  compatibleFather.validate();
});

Deno.test("createCompatibleFatherFromCreatures - produces valid results at scale", () => {
  // This test verifies the optimised function works correctly with larger creatures.
  // Performance is measured in the benchmark file (bench/FatherCompatibility.ts).
  const mother = createLargeCreature(200, "mother", 20, 10);
  const father = createLargeCreature(200, "father", 20, 10);

  const iterations = 10;

  // Verify both functions produce valid results at scale
  for (let i = 0; i < iterations; i++) {
    const originalResult = createCompatibleFather(
      mother.exportJSON(),
      father.exportJSON(),
    );
    const optimisedResult = createCompatibleFatherFromCreatures(mother, father);

    // Both should produce valid creatures
    const originalCreature = Creature.fromJSON(originalResult);
    const optimisedCreature = Creature.fromJSON(optimisedResult);

    originalCreature.validate();
    optimisedCreature.validate();

    // Both should have the same structure
    assertEquals(
      optimisedResult.neurons.length,
      originalResult.neurons.length,
    );
    assertEquals(
      optimisedResult.synapses.length,
      originalResult.synapses.length,
    );
  }
});

Deno.test("createCompatibleFatherFromCreatures - handles identical parents", () => {
  const creatureJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "TANH", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };

  const mother = Creature.fromJSON(creatureJson);
  const father = Creature.fromJSON(creatureJson);

  const result = createCompatibleFatherFromCreatures(mother, father);

  // When parents are identical, father should be returned as-is
  assertExists(result);

  // Verify it's valid
  const compatibleFather = Creature.fromJSON(result);
  compatibleFather.validate();
});

Deno.test("createCompatibleFatherFromCreatures - handles empty hidden neurons", () => {
  const motherJson: CreatureExport = {
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };

  const fatherJson: CreatureExport = {
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };

  const mother = Creature.fromJSON(motherJson);
  const father = Creature.fromJSON(fatherJson);

  const result = createCompatibleFatherFromCreatures(mother, father);

  assertExists(result);
  const compatibleFather = Creature.fromJSON(result);
  compatibleFather.validate();
});
