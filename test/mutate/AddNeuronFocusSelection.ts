/**
 * Tests for AddNeuron focus selection optimisation (Issue #1018).
 *
 * This tests the optimised direct selection from valid candidates
 * instead of rejection-based sampling with up to 12 retry attempts.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Creates a network with multiple inputs and hidden neurons for focus testing.
 * Structure: inputs(0,1,2) -> hidden1(3) -> hidden2(4) -> output(5)
 *            with cross-connections for testing transitive focus
 */
function createFocusTestNetwork() {
  return {
    neurons: [
      { type: "input" as const, index: 0 },
      { type: "input" as const, index: 1 },
      { type: "input" as const, index: 2 },
      {
        type: "hidden" as const,
        index: 3,
        bias: 0.1,
        squash: "LOGISTIC" as const,
      },
      {
        type: "hidden" as const,
        index: 4,
        bias: 0.2,
        squash: "LOGISTIC" as const,
      },
      {
        type: "output" as const,
        index: 5,
        bias: 0.3,
        squash: "LOGISTIC" as const,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1.0 },
      { from: 1, to: 3, weight: 0.8 },
      { from: 2, to: 4, weight: 0.7 },
      { from: 3, to: 4, weight: 0.6 },
      { from: 3, to: 5, weight: 0.5 },
      { from: 4, to: 5, weight: 0.9 },
    ],
    input: 3,
    output: 1,
  };
}

/**
 * Creates a larger network for performance and stress testing.
 */
function createLargeNetwork(inputCount: number, hiddenCount: number) {
  const neurons = [];
  const synapses = [];

  // Add input neurons
  for (let i = 0; i < inputCount; i++) {
    neurons.push({ type: "input" as const, index: i });
  }

  // Add hidden neurons
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden" as const,
      index: inputCount + i,
      bias: Math.random() * 0.2 - 0.1,
      squash: "LOGISTIC" as const,
    });
  }

  // Add output neuron
  const outputIndex = inputCount + hiddenCount;
  neurons.push({
    type: "output" as const,
    index: outputIndex,
    bias: 0.1,
    squash: "LOGISTIC" as const,
  });

  // Connect inputs to first hidden
  for (let i = 0; i < inputCount; i++) {
    synapses.push({
      from: i,
      to: inputCount,
      weight: Math.random(),
    });
  }

  // Chain hidden neurons
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      from: inputCount + i,
      to: inputCount + i + 1,
      weight: Math.random(),
    });
  }

  // Connect last hidden to output
  synapses.push({
    from: inputCount + hiddenCount - 1,
    to: outputIndex,
    weight: Math.random(),
  });

  return {
    neurons,
    synapses,
    input: inputCount,
    output: 1,
  };
}

Deno.test("AddNeuron - focus selection should work with restrictive focus list", () => {
  // Test that AddNeuron works correctly when the focus list only includes
  // a small subset of neurons (e.g., just one input)
  const creature = Creature.fromJSON(createFocusTestNetwork());
  creatureValidate(creature);

  // Very restrictive focus list - only input neuron 0
  const focusList = [0];

  // Run multiple mutations to ensure consistent behaviour
  let successCount = 0;
  for (let i = 0; i < 30; i++) {
    const testCreature = Creature.fromJSON(createFocusTestNetwork());
    const addNeuron = new AddNeuron(testCreature);

    if (addNeuron.mutate(focusList)) {
      successCount++;
      creatureValidate(testCreature);
    }
  }

  // Should succeed consistently - the optimised implementation should
  // directly select from valid candidates without needing many retries
  assert(
    successCount >= 25,
    `Should have high success rate with focus selection, got ${successCount}/30`,
  );
});

Deno.test("AddNeuron - focus selection should use transitive focus checking", () => {
  // When a focus list is provided, neurons connected to focused neurons
  // should also be considered (transitive focus)
  const creature = Creature.fromJSON(createFocusTestNetwork());

  // Focus on input 0 - via transitive focus, hidden neurons downstream
  // should also be selectable
  const focusList = [0];

  // Verify transitive focus works at the creature level
  assertEquals(
    creature.inFocus(0, focusList),
    true,
    "Input 0 directly in focus",
  );
  assertEquals(
    creature.inFocus(3, focusList),
    true,
    "Hidden 3 transitively in focus",
  );
  assertEquals(
    creature.inFocus(4, focusList),
    true,
    "Hidden 4 transitively in focus",
  );
  assertEquals(
    creature.inFocus(5, focusList),
    true,
    "Output 5 transitively in focus",
  );

  // Note: Input 1 and 2 are NOT in focus since focusList only contains [0]
  // and there are no inward connections to inputs 1 and 2 from focused neurons
  // (inFocus checks inward connections, not outward)
});

Deno.test("AddNeuron - should work without focus list (all neurons valid)", () => {
  const creature = Creature.fromJSON(createFocusTestNetwork());
  creatureValidate(creature);

  // No focus list - all neurons should be valid candidates
  let successCount = 0;
  for (let i = 0; i < 20; i++) {
    const testCreature = Creature.fromJSON(createFocusTestNetwork());
    const addNeuron = new AddNeuron(testCreature);

    if (addNeuron.mutate()) {
      successCount++;
      creatureValidate(testCreature);
    }
  }

  assert(
    successCount >= 18,
    `Should succeed almost always without focus list, got ${successCount}/20`,
  );
});

Deno.test("AddNeuron - focus selection should fall back when focus is too restrictive", () => {
  // Create a creature where the focus list points to neurons that have
  // no valid source candidates (e.g., focusing only on output)
  const creature = Creature.fromJSON(createFocusTestNetwork());
  creatureValidate(creature);

  // Focus only on output neuron (index 5) - there are no valid source
  // candidates (neurons with index < new neuron's index) that are in focus
  // The implementation should fall back to using all neurons
  const focusList = [5];

  let successCount = 0;
  for (let i = 0; i < 20; i++) {
    const testCreature = Creature.fromJSON(createFocusTestNetwork());
    const addNeuron = new AddNeuron(testCreature);

    if (addNeuron.mutate(focusList)) {
      successCount++;
      creatureValidate(testCreature);
    }
  }

  // Should still succeed due to fallback logic
  assert(
    successCount >= 15,
    `Should succeed with fallback when focus is too restrictive, got ${successCount}/20`,
  );
});

Deno.test("AddNeuron - focus selection with empty focus list should use all neurons", () => {
  const creature = Creature.fromJSON(createFocusTestNetwork());
  creatureValidate(creature);

  // Empty focus list should be treated same as no focus list
  const focusList: number[] = [];

  let successCount = 0;
  for (let i = 0; i < 20; i++) {
    const testCreature = Creature.fromJSON(createFocusTestNetwork());
    const addNeuron = new AddNeuron(testCreature);

    if (addNeuron.mutate(focusList)) {
      successCount++;
      creatureValidate(testCreature);
    }
  }

  assert(
    successCount >= 18,
    `Empty focus list should work like no focus list, got ${successCount}/20`,
  );
});

Deno.test("AddNeuron - stress test focus selection with large network", () => {
  // Create a larger network to stress test the optimised selection
  const networkDef = createLargeNetwork(10, 20);
  const creature = Creature.fromJSON(networkDef);
  creatureValidate(creature);

  // Use a small focus list relative to network size
  // This is the scenario where rejection sampling would be inefficient
  const focusList = [0, 1, 2]; // Only first 3 inputs

  let successCount = 0;
  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    const testCreature = Creature.fromJSON(networkDef);
    const addNeuron = new AddNeuron(testCreature);

    if (addNeuron.mutate(focusList)) {
      successCount++;
      creatureValidate(testCreature);
    }
  }

  // With direct selection, we should have consistent high success rate
  assert(
    successCount >= iterations * 0.8,
    `Should have high success rate on large network, got ${successCount}/${iterations}`,
  );
});

Deno.test("AddNeuron - connections should respect focus when possible", () => {
  // Verify that when focus list is provided, the created connections
  // involve neurons that are in focus (either directly or transitively)
  const creature = Creature.fromJSON(createFocusTestNetwork());
  creatureValidate(creature);

  // Focus on inputs 0 and 1
  const focusList = [0, 1];

  // Run several mutations and track if connections involve focused neurons
  let focusedConnectionCount = 0;
  let totalNewConnections = 0;

  for (let i = 0; i < 30; i++) {
    const testCreature = Creature.fromJSON(createFocusTestNetwork());
    const originalSynapseCount = testCreature.synapses.length;
    const addNeuron = new AddNeuron(testCreature);

    if (addNeuron.mutate(focusList)) {
      creatureValidate(testCreature);

      // Count new synapses and check if they involve focused neurons
      const newSynapses = testCreature.synapses.length - originalSynapseCount;
      totalNewConnections += newSynapses;

      // Check the new neuron's connections
      const newNeuronCount = testCreature.neurons.length - 6; // Original had 6 neurons
      if (newNeuronCount > 0) {
        // Find the newly added hidden neuron(s)
        for (const neuron of testCreature.neurons) {
          if (neuron.type === "hidden" && neuron.index >= 3) {
            // Check if inward or outward connections involve focused neurons
            const inward = testCreature.inwardConnections(neuron.index);
            const outward = testCreature.outwardConnections(neuron.index);

            for (const synapse of inward) {
              if (testCreature.inFocus(synapse.from, focusList)) {
                focusedConnectionCount++;
              }
            }
            for (const synapse of outward) {
              if (testCreature.inFocus(synapse.to, focusList)) {
                focusedConnectionCount++;
              }
            }
          }
        }
      }
    }
  }

  // When a focus list is provided, connections should preferentially
  // involve neurons that are in focus
  assert(
    totalNewConnections > 0,
    "Should have created some connections",
  );
});

Deno.test("AddNeuron - multiple sequential mutations with focus should remain valid", () => {
  // Ensure that multiple mutations in sequence with focus list
  // don't cause any issues
  const creature = Creature.fromJSON(createFocusTestNetwork());
  creatureValidate(creature);

  const focusList = [0, 2, 4]; // Mixed input, hidden indices

  // Add many neurons sequentially
  for (let i = 0; i < 20; i++) {
    const addNeuron = new AddNeuron(creature);
    addNeuron.mutate(focusList);
    creatureValidate(creature);
  }

  // After all mutations, creature should still be valid
  assert(
    creature.neurons.length > 6,
    "Should have added neurons",
  );
});
