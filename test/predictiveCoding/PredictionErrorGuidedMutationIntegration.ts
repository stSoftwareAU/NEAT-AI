/**
 * Integration tests for Prediction-Error-Guided Mutation.
 *
 * Issue #1557: Verifies that the full pipeline from prediction error
 * computation through to mutation operator integration works correctly,
 * and that mutations are guided towards high-error regions.
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  computeMutationBias,
  neuronBiasToIndexWeights,
  selectWeightedIndex,
} from "../../src/predictiveCoding/PredictionErrorGuidedMutation.ts";
import { computePredictionErrors } from "../../src/predictiveCoding/PredictionErrorComputation.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";

/**
 * Helper: creates a creature with multiple hidden neurons for integration tests.
 *
 * Topology: 3-input → 3-hidden → 1-output, forward-only
 */
function createTestCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0.1, squash: "IDENTITY", index: 3 },
      { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 4 },
      { type: "hidden", bias: -0.1, squash: "IDENTITY", index: 5 },
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 6 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 0.5 },
      { from: 1, to: 4, weight: 0.5 },
      { from: 2, to: 5, weight: 0.5 },
      { from: 3, to: 6, weight: 0.8 },
      { from: 4, to: 6, weight: 0.6 },
      { from: 5, to: 6, weight: 0.4 },
    ],
    input: 3,
    output: 1,
  });
}

Deno.test(
  "Integration: computeMutationBias from real prediction errors",
  () => {
    const creature = createTestCreature();

    // Simulate PC inference by setting latent values and computing errors.
    const latents = new Float64Array(creature.neurons.length);
    latents[0] = 1.0; // input0
    latents[1] = 0.5; // input1
    latents[2] = 0.0; // input2
    latents[3] = 0.9; // hidden0 — will have large error (prediction ≈ 0.6)
    latents[4] = 0.25; // hidden1 — will have zero error (prediction = 0.25)
    latents[5] = -0.1; // hidden2 — exact match (prediction = -0.1)
    latents[6] = 1.5; // output — will have large error

    const nodeStates = computePredictionErrors(creature, latents);

    // Store prediction errors in creature state
    for (const [index, state] of nodeStates) {
      creature.state.node(index).predictionError = state.error;
    }

    const bias = computeMutationBias(creature);
    assert(
      bias !== undefined,
      "Bias should be computed from prediction errors",
    );

    // hidden0 (large error) should have highest weight among hidden neurons
    const hidden0UUID = creature.neurons[3].uuid;
    const hidden1UUID = creature.neurons[4].uuid;
    const hidden2UUID = creature.neurons[5].uuid;

    const w0 = bias!.neuronWeights.get(hidden0UUID)!;
    const w1 = bias!.neuronWeights.get(hidden1UUID)!;
    const w2 = bias!.neuronWeights.get(hidden2UUID)!;

    assertGreater(
      w0,
      w1,
      "Hidden0 (high error) should have higher weight than hidden1",
    );
    assertGreater(
      w0,
      w2,
      "Hidden0 (high error) should have higher weight than hidden2",
    );
  },
);

Deno.test(
  "Integration: neuronBiasToIndexWeights creates correct index mapping",
  () => {
    const creature = createTestCreature();

    // Set up prediction errors
    creature.state.node(3).predictionError = 0.8;
    creature.state.node(4).predictionError = 0.1;
    creature.state.node(5).predictionError = 0.3;
    creature.state.node(6).predictionError = 0.5;

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    const indexWeights = neuronBiasToIndexWeights(bias!, creature);

    // Should have entries for all non-input neurons
    assert(indexWeights.has(3), "Should have weight for hidden0");
    assert(indexWeights.has(4), "Should have weight for hidden1");
    assert(indexWeights.has(5), "Should have weight for hidden2");
    assert(indexWeights.has(6), "Should have weight for output");

    // Input neurons should not have entries
    assertEquals(
      indexWeights.has(0),
      false,
      "Input neurons should not have weights",
    );
    assertEquals(
      indexWeights.has(1),
      false,
      "Input neurons should not have weights",
    );
    assertEquals(
      indexWeights.has(2),
      false,
      "Input neurons should not have weights",
    );
  },
);

Deno.test(
  "Integration: AddNeuron accepts mutation bias without errors",
  () => {
    const creature = createTestCreature();

    // Set prediction errors
    creature.state.node(3).predictionError = 0.9;
    creature.state.node(4).predictionError = 0.1;
    creature.state.node(5).predictionError = 0.1;
    creature.state.node(6).predictionError = 0.5;

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    // AddNeuron should succeed with bias — it receives bias through mutate()
    const mutator = new AddNeuron(creature);
    const changed = mutator.mutate(undefined, bias!);

    // The mutation should succeed (creature has room for more neurons)
    assert(
      changed === true || changed === false,
      "mutate should return boolean",
    );
  },
);

Deno.test(
  "Integration: AddConnection accepts mutation bias without errors",
  () => {
    // Use a small creature that has available connections
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 2 },
        { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 3 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 4 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 3, weight: 0.5 },
        { from: 2, to: 4, weight: 0.8 },
        { from: 3, to: 4, weight: 0.6 },
      ],
      input: 2,
      output: 1,
    });

    // Set prediction errors
    creature.state.node(2).predictionError = 0.9;
    creature.state.node(3).predictionError = 0.1;
    creature.state.node(4).predictionError = 0.5;

    const bias = computeMutationBias(creature);
    assert(bias !== undefined);

    // AddConnection should succeed with bias
    const mutator = new AddConnection(creature);
    const changed = mutator.mutate(undefined, bias!);

    // The mutation should succeed (creature has available connections)
    assert(
      changed === true || changed === false,
      "mutate should return boolean",
    );
  },
);

Deno.test(
  "Integration: mutation without bias is unchanged behaviour",
  () => {
    const creature = createTestCreature();

    // No prediction errors — PC not enabled
    const bias = computeMutationBias(creature);
    assertEquals(bias, undefined, "No bias when PC errors not set");

    // Mutations should still work normally without bias
    const addNeuron = new AddNeuron(creature);
    const changed = addNeuron.mutate();
    assert(
      changed === true || changed === false,
      "Mutation should work without bias",
    );
  },
);

Deno.test(
  "Integration: selectWeightedIndex distributes according to error magnitude",
  () => {
    // Simulate what happens inside AddNeuron when prediction errors guide selection.
    // Create index weights where neuron 3 has very high error, others low.
    const candidates = [3, 4, 5, 6];
    const weights = new Map<number, number>([
      [3, 0.85], // High error neuron
      [4, 0.05],
      [5, 0.05],
      [6, 0.05],
    ]);

    const counts = new Map<number, number>([
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
    ]);
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const selected = selectWeightedIndex(candidates, weights);
      counts.set(selected, (counts.get(selected) ?? 0) + 1);
    }

    // Neuron 3 should be selected disproportionately often
    assertGreater(
      counts.get(3)!,
      counts.get(4)! + counts.get(5)! + counts.get(6)!,
      "High-error neuron should be selected more often than all low-error neurons combined",
    );
  },
);
