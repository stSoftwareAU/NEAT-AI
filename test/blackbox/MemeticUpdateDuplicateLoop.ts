/**
 * Tests for MemeticUpdate functionality.
 * Issue #1392: Verify memeticUpdate correctly tracks bias and weight changes
 * between parent and child creatures (after fixing the duplicate loop).
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { memeticUpdate } from "../../src/blackbox/MemeticUpdate.ts";
import type { MemeticInterface } from "../../src/blackbox/MemeticInterface.ts";

function createTestCreature(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toId: 5001, weight: 0.5 },
      { fromUUID: "hidden-1", toId: -1, weight: 0.8 },
    ],
  };
}

Deno.test("memeticUpdate - detects bias changes between parent and child", () => {
  const parentJSON = createTestCreature();
  const parent = Creature.fromJSON(parentJSON);
  parent.memetic = { generation: 1, score: 0.5, biases: {}, weights: {} };

  // Create a child with a different bias on hidden-1
  const childJSON = createTestCreature();
  childJSON.neurons[0].bias = 0.7; // Changed from 0.5
  const child = Creature.fromJSON(childJSON);

  const result = memeticUpdate(parent, child);
  assert(result, "Should return a MemeticInterface");
  assert(result.biases, "Should have biases object");
  // The hidden neuron is at index 2 (after 2 inputs), use its numeric ID
  const hiddenId = parent.neurons[2].id;
  assert(
    result.biases[hiddenId] !== undefined,
    "Should track bias change for hidden neuron",
  );
});

Deno.test("memeticUpdate - detects weight changes between parent and child", () => {
  const parentJSON = createTestCreature();
  const parent = Creature.fromJSON(parentJSON);
  parent.memetic = { generation: 1, score: 0.5, biases: {}, weights: {} };

  // Create a child with a different weight
  const childJSON = createTestCreature();
  childJSON.synapses[0].weight = 0.9; // Changed from 0.5
  const child = Creature.fromJSON(childJSON);

  const result = memeticUpdate(parent, child);
  assert(result, "Should return a MemeticInterface");
  assert(result.weights, "Should have weights object");
});

Deno.test("memeticUpdate - returns undefined when neuron counts differ", () => {
  const parentJSON = createTestCreature();
  const parent = Creature.fromJSON(parentJSON);
  parent.memetic = { generation: 1, score: 0.5, biases: {}, weights: {} };

  // Create a child with extra neuron
  const childJSON = createTestCreature();
  childJSON.neurons.splice(1, 0, {
    type: "hidden",
    uuid: "hidden-2",
    squash: "TANH",
    bias: 0.3,
  });
  childJSON.synapses.push(
    { fromUUID: "hidden-1", toId: 5002, weight: 0.5 },
    { fromUUID: "hidden-2", toId: -1, weight: 0.4 },
  );
  const child = Creature.fromJSON(childJSON);

  const result = memeticUpdate(parent, child);
  assertEquals(
    result,
    undefined,
    "Should return undefined when neuron counts differ",
  );
});

Deno.test("memeticUpdate - returns undefined when squash functions differ", () => {
  const parentJSON = createTestCreature();
  const parent = Creature.fromJSON(parentJSON);
  parent.memetic = { generation: 1, score: 0.5, biases: {}, weights: {} };

  // Create a child with a different squash
  const childJSON = createTestCreature();
  childJSON.neurons[0].squash = "TANH"; // Changed from LOGISTIC
  const child = Creature.fromJSON(childJSON);

  const result = memeticUpdate(parent, child);
  assertEquals(
    result,
    undefined,
    "Should return undefined when squash functions differ",
  );
});

Deno.test("memeticUpdate - preserves existing memetic data", () => {
  const parentJSON = createTestCreature();
  const parent = Creature.fromJSON(parentJSON);
  const existingMemetic: MemeticInterface = {
    generation: 1,
    score: 0.5,
    biases: { 5001: 0.3 },
    weights: {
      0: [{ toId: 5001, weight: 0.4 }],
    },
  };
  parent.memetic = existingMemetic;

  // Create identical child (no changes)
  const childJSON = createTestCreature();
  const child = Creature.fromJSON(childJSON);

  const result = memeticUpdate(parent, child);
  assert(result, "Should return a MemeticInterface");
  // The existing memetic biases should be preserved
  assertEquals(
    result.biases?.[5001],
    0.3,
    "Should preserve existing memetic bias data",
  );
});
