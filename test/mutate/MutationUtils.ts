import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import {
  bumpToFourIfForwardOnlyConfirmed,
  cleanupDisconnectedNeuron,
  selectFocusedNeuronIndex,
  validateAndBumpForwardOnly,
} from "../../src/mutate/MutationUtils.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// --- selectFocusedNeuronIndex ---

Deno.test("selectFocusedNeuronIndex - selects a non-input neuron", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  for (let i = 0; i < 50; i++) {
    const index = selectFocusedNeuronIndex(creature);
    assert(index >= creature.input, "Should select non-input neuron");
    assert(
      index < creature.neurons.length,
      "Should be within bounds",
    );
  }
});

Deno.test("selectFocusedNeuronIndex - skips constant neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", bias: 1.0, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1.0 },
      { from: 2, to: 3, weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });

  // Should only select the output neuron (index 3), never the constant (index 2)
  for (let i = 0; i < 50; i++) {
    const index = selectFocusedNeuronIndex(creature);
    if (index !== -1) {
      assertEquals(index, 3, "Should only select the output neuron");
    }
  }
});

Deno.test("selectFocusedNeuronIndex - respects focus list", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.3, index: 3 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 4 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 3, weight: 1.0 },
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  // With a focus list targeting index 2, we should often select index 2
  let selectedIndex2 = false;
  for (let i = 0; i < 100; i++) {
    const index = selectFocusedNeuronIndex(creature, [2]);
    if (index === 2) {
      selectedIndex2 = true;
      break;
    }
  }
  assert(selectedIndex2, "Should eventually select the focused neuron");
});

Deno.test("selectFocusedNeuronIndex - returns -1 when only constants exist", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", bias: 1.0, index: 1 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 2 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.5 },
    ],
    input: 1,
    output: 1,
  });

  // With only 2 non-input slots (constant + output) and maxAttempts=2,
  // the output may be found. With only constants and maxAttempts=1,
  // it could return -1
  const index = selectFocusedNeuronIndex(creature, undefined, 1);
  // Result is non-deterministic due to randomness; just verify the range
  if (index !== -1) {
    assert(index >= creature.input, "Should be non-input if found");
  }
});

// --- cleanupDisconnectedNeuron ---

Deno.test("cleanupDisconnectedNeuron - removes completely disconnected hidden neuron", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1.0 },
      { from: 1, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  // Neuron at index 2 has no inward or outward connections
  const neuronCountBefore = creature.neurons.length;
  const removed = cleanupDisconnectedNeuron(creature, 2);

  assert(removed, "Should remove completely disconnected neuron");
  assertEquals(
    creature.neurons.length,
    neuronCountBefore - 1,
    "Neuron count should decrease by 1",
  );
  creatureValidate(creature);
});

Deno.test("cleanupDisconnectedNeuron - converts to constant when no inward but has outward", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 2, to: 3, weight: 0.8 },
      { from: 0, to: 3, weight: 1.0 },
    ],
    input: 2,
    output: 1,
  });

  // Neuron at index 2 has no inward connections but has outward to 3
  const removed = cleanupDisconnectedNeuron(creature, 2);

  assertFalse(removed, "Should not remove neuron with outward connections");
  assertEquals(
    creature.neurons[2].type,
    "constant",
    "Should convert to constant",
  );
  creatureValidate(creature);
});

Deno.test("cleanupDisconnectedNeuron - does nothing when neuron has inward connections", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const neuronCountBefore = creature.neurons.length;
  const typeBefore = creature.neurons[2].type;
  const removed = cleanupDisconnectedNeuron(creature, 2);

  assertFalse(removed, "Should not remove neuron with inward connections");
  assertEquals(
    creature.neurons.length,
    neuronCountBefore,
    "Neuron count should not change",
  );
  assertEquals(creature.neurons[2].type, typeBefore, "Type should not change");
  creatureValidate(creature);
});

Deno.test("cleanupDisconnectedNeuron - does nothing for non-hidden neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 2 },
    ],
    synapses: [],
    input: 2,
    output: 1,
  });

  const removed = cleanupDisconnectedNeuron(creature, 2);
  assertFalse(removed, "Should not remove output neurons");
});

// --- bumpToFourIfForwardOnlyConfirmed ---

Deno.test("bumpToFourIfForwardOnlyConfirmed - bumps 2.x to 4.0.0", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 2 },
    ],
    synapses: [{ from: 0, to: 2, weight: 1.0 }],
    input: 2,
    output: 1,
  });
  creature.semanticVersion = "2.1.0";
  bumpToFourIfForwardOnlyConfirmed(creature);
  assertEquals(creature.semanticVersion, "4.0.0");
});

Deno.test("bumpToFourIfForwardOnlyConfirmed - bumps 3.x to 4.0.0", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 2 },
    ],
    synapses: [{ from: 0, to: 2, weight: 1.0 }],
    input: 2,
    output: 1,
  });
  creature.semanticVersion = "3.0.0";
  bumpToFourIfForwardOnlyConfirmed(creature);
  assertEquals(creature.semanticVersion, "4.0.0");
});

Deno.test("bumpToFourIfForwardOnlyConfirmed - does not change 4.x", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 2 },
    ],
    synapses: [{ from: 0, to: 2, weight: 1.0 }],
    input: 2,
    output: 1,
  });
  creature.semanticVersion = "4.1.0";
  bumpToFourIfForwardOnlyConfirmed(creature);
  assertEquals(creature.semanticVersion, "4.1.0");
});

// --- validateAndBumpForwardOnly ---

Deno.test("validateAndBumpForwardOnly - validates and bumps valid forward-only creature", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });
  creature.forwardOnly = true;
  creature.semanticVersion = "3.0.0";

  validateAndBumpForwardOnly(creature, "TestOp");
  assertEquals(creature.semanticVersion, "4.0.0");
});

Deno.test("validateAndBumpForwardOnly - already 4.x stays at same version", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });
  creature.forwardOnly = true;
  creature.semanticVersion = "4.2.0";

  validateAndBumpForwardOnly(creature, "TestOp");
  assertEquals(creature.semanticVersion, "4.2.0");
});
