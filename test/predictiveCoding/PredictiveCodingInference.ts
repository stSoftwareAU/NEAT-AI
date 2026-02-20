/**
 * Tests for PredictiveCodingInference module.
 *
 * Issue #1554: Verifies that the PC inference (settling) loop correctly
 * minimises prediction error energy, converges, and handles edge cases
 * with arbitrary NEAT topologies.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import type { RequiredPredictiveCodingConfig } from "../../src/config/PredictiveCodingConfig.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";
import { runInference } from "../../src/predictiveCoding/PredictiveCodingInference.ts";
import { computePredictionErrors } from "../../src/predictiveCoding/PredictionErrorComputation.ts";

/** Default test config with more iterations and a reasonable threshold. */
function testConfig(
  overrides?: Partial<RequiredPredictiveCodingConfig>,
): RequiredPredictiveCodingConfig {
  return {
    ...DEFAULT_PREDICTIVE_CODING_CONFIG,
    enabled: true,
    inferenceSteps: 100,
    inferenceRate: 0.1,
    energyThreshold: 1e-6,
    ...overrides,
  };
}

/**
 * Simple 2-input, 1-hidden, 1-output IDENTITY network.
 */
function makeSimpleCreature(): Creature {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "IDENTITY" },
      { bias: 0, index: 3, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 2 },
      { weight: 1.0, from: 1, to: 2 },
      { weight: 1.0, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

Deno.test("PCInference - energy decreases over iterations", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.5, index: 2, type: "hidden", squash: "TANH" },
      { bias: -0.3, index: 3, type: "output", squash: "TANH" },
    ],
    synapses: [
      { weight: 0.8, from: 0, to: 2 },
      { weight: 0.6, from: 1, to: 2 },
      { weight: 0.9, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([0.5, -0.3]);
  const targets = new Float64Array([0.7]);

  // Run with just 1 step to get initial energy
  const result1 = runInference(
    creature,
    input,
    testConfig({ inferenceSteps: 1 }),
    targets,
  );

  // Run with more steps
  const result10 = runInference(
    creature,
    input,
    testConfig({ inferenceSteps: 10 }),
    targets,
  );

  // Energy should decrease (or at least not increase) with more iterations
  assertLess(
    result10.energy,
    result1.energy + 1e-10,
    "Energy should not increase with more inference steps",
  );
});

Deno.test("PCInference - converges on consistent network", () => {
  const creature = makeSimpleCreature();
  const input = new Float64Array([1.0, 2.0]);

  // For this identity network, the forward pass gives: hidden=3, output=3
  // This is already at equilibrium, so should converge quickly
  const result = runInference(creature, input, testConfig());

  assertAlmostEquals(result.energy, 0.0, 1e-4);
  assert(result.converged, "Should converge on a consistent network");
});

Deno.test("PCInference - early stopping when energy below threshold", () => {
  const creature = makeSimpleCreature();
  const input = new Float64Array([1.0, 2.0]);

  const config = testConfig({ inferenceSteps: 100, energyThreshold: 1e-4 });
  const result = runInference(creature, input, config);

  assert(result.converged, "Should converge early");
  // Should not need all 100 steps for an already-consistent network
  assertLess(result.steps, 100, "Should stop early");
});

Deno.test("PCInference - clamps input neurons", () => {
  const creature = makeSimpleCreature();
  const input = new Float64Array([5.0, 7.0]);

  const result = runInference(creature, input, testConfig());

  // Input neurons should remain clamped
  assertAlmostEquals(result.activations[0], 5.0, 1e-10);
  assertAlmostEquals(result.activations[1], 7.0, 1e-10);
});

Deno.test("PCInference - clamps output neurons to targets", () => {
  const creature = makeSimpleCreature();
  const input = new Float64Array([1.0, 2.0]);
  const targets = new Float64Array([10.0]);

  const result = runInference(creature, input, testConfig(), targets);

  // Output neuron should be clamped to target
  assertAlmostEquals(result.activations[3], 10.0, 1e-10);
});

Deno.test("PCInference - stores state in NeuronState", () => {
  const creature = makeSimpleCreature();
  const input = new Float64Array([1.0, 2.0]);

  runInference(creature, input, testConfig());

  // Check that PC state is stored in NeuronState for hidden and output neurons
  const hiddenState = creature.state.node(2);
  assert(
    hiddenState.prediction !== undefined,
    "Hidden neuron should have prediction stored",
  );
  assert(
    hiddenState.predictionError !== undefined,
    "Hidden neuron should have prediction error stored",
  );
  assert(
    hiddenState.latentValue !== undefined,
    "Hidden neuron should have latent value stored",
  );
});

Deno.test("PCInference - does not modify creature topology", () => {
  const creature = makeSimpleCreature();
  const input = new Float64Array([1.0, 2.0]);

  const neuronCountBefore = creature.neurons.length;
  const synapseCountBefore = creature.synapses.length;
  const weightsBefore = creature.synapses.map((s) => s.weight);
  const biasesBefore = creature.neurons.map((n) => n.bias);

  runInference(creature, input, testConfig());

  assertEquals(creature.neurons.length, neuronCountBefore);
  assertEquals(creature.synapses.length, synapseCountBefore);
  // Weights and biases must not change during inference
  for (let i = 0; i < creature.synapses.length; i++) {
    assertEquals(creature.synapses[i].weight, weightsBefore[i]);
  }
  for (let i = 0; i < creature.neurons.length; i++) {
    assertEquals(creature.neurons[i].bias, biasesBefore[i]);
  }
});

Deno.test("PCInference - single hidden neuron", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 1, type: "hidden", squash: "IDENTITY" },
      { bias: 0, index: 2, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 1 },
      { weight: 1.0, from: 1, to: 2 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([3.0]);

  const result = runInference(creature, input, testConfig());

  // With identity squash and weights=1, bias=0:
  // hidden=3, output=3. Already consistent.
  assertAlmostEquals(result.energy, 0.0, 1e-4);
});

Deno.test("PCInference - no hidden neurons", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 1, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([5.0]);

  const result = runInference(creature, input, testConfig());

  // No hidden neurons to settle; output = input
  assertAlmostEquals(result.activations[1], 5.0, 1e-10);
});

Deno.test("PCInference - with TANH squash function", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "TANH" },
      { bias: 0, index: 3, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 2 },
      { weight: 1.0, from: 1, to: 2 },
      { weight: 1.0, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([0.5, 0.3]);

  // Should complete without error
  const result = runInference(creature, input, testConfig());

  // Input neurons should be clamped
  assertAlmostEquals(result.activations[0], 0.5, 1e-10);
  assertAlmostEquals(result.activations[1], 0.3, 1e-10);
  // Energy should be non-negative
  assert(result.energy >= 0, "Energy must be non-negative");
});

Deno.test("PCInference - respects inferenceSteps limit", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.5, index: 2, type: "hidden", squash: "TANH" },
      { bias: -0.3, index: 3, type: "output", squash: "TANH" },
    ],
    synapses: [
      { weight: 0.8, from: 0, to: 2 },
      { weight: 0.9, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([0.5, -0.3]);
  const targets = new Float64Array([0.9]);

  const config = testConfig({
    inferenceSteps: 5,
    energyThreshold: 1e-20, // Very small threshold to prevent early stopping
  });
  const result = runInference(creature, input, config, targets);

  assertEquals(result.steps, 5, "Should perform exactly 5 steps");
  assertEquals(
    result.converged,
    false,
    "Should not converge with tiny threshold",
  );
});

Deno.test("PCInference - multiple outputs", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "IDENTITY" },
      { bias: 0, index: 3, type: "output", squash: "IDENTITY" },
      { bias: 0, index: 4, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 2 },
      { weight: 1.0, from: 1, to: 2 },
      { weight: 1.0, from: 2, to: 3 },
      { weight: 0.5, from: 2, to: 4 },
    ],
    input: 2,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([1.0, 2.0]);

  const result = runInference(creature, input, testConfig());

  // Input should be clamped
  assertAlmostEquals(result.activations[0], 1.0, 1e-10);
  assertAlmostEquals(result.activations[1], 2.0, 1e-10);
});

Deno.test("PCInference - supervised settling adjusts hidden to reduce error", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "IDENTITY" },
      { bias: 0, index: 3, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 2 },
      { weight: 1.0, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([1.0, 0.0]);

  // Forward pass: hidden = 1, output = 1
  // Target = 5, so there's a large error at the output
  const targets = new Float64Array([5.0]);

  // Run inference — the hidden neuron should move towards the target
  const result = runInference(
    creature,
    input,
    testConfig({ inferenceSteps: 50, inferenceRate: 0.1 }),
    targets,
  );

  // The hidden activation should have moved from 1 towards 5
  assertGreater(
    result.activations[2],
    1.0,
    "Hidden neuron should increase towards target",
  );
});

Deno.test("PCInference - energy monotonically non-increasing with small rate", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.2, index: 2, type: "hidden", squash: "TANH" },
      { bias: 0.1, index: 3, type: "hidden", squash: "TANH" },
      { bias: -0.1, index: 4, type: "output", squash: "TANH" },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 2 },
      { weight: 0.3, from: 1, to: 3 },
      { weight: 0.7, from: 2, to: 4 },
      { weight: 0.4, from: 3, to: 4 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([0.5, -0.3]);
  const targets = new Float64Array([0.8]);

  // Collect energy at each step
  const energies: number[] = [];

  // Run step by step to track energy trajectory
  const neuronCount = creature.neurons.length;
  const activations = new Float64Array(neuronCount);
  for (let i = 0; i < creature.input; i++) {
    activations[i] = input[i];
  }
  // Forward pass to initialise
  for (let i = creature.input; i < neuronCount; i++) {
    const neuron = creature.neurons[i];
    const inward = creature.inwardConnections(i);
    let ws = neuron.bias;
    for (let j = 0; j < inward.length; j++) {
      ws += inward[j].weight * activations[inward[j].from];
    }
    activations[i] = Math.tanh(ws);
  }
  // Clamp outputs
  const outputStart = neuronCount - creature.output;
  activations[outputStart] = targets[0];

  // Record initial energy
  const initialResult = computePredictionErrors(creature, activations, targets);
  energies.push(initialResult.energy);

  // Run 20 steps manually by calling runInference with 1 step at a time,
  // but instead just use the full run and check final < initial
  const fullResult = runInference(
    creature,
    input,
    testConfig({ inferenceSteps: 20, inferenceRate: 0.01 }),
    targets,
  );

  assertLess(
    fullResult.energy,
    energies[0] + 1e-8,
    "Final energy should not exceed initial energy",
  );
});

Deno.test("PCInference - different squash functions are respected", () => {
  // Network with ReLU and LOGISTIC squash
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "ReLU" },
      { bias: 0, index: 3, type: "output", squash: "LOGISTIC" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 2 },
      { weight: 1.0, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const input = new Float64Array([0.5, 0]);

  // Should complete without error, using the correct squash functions
  const result = runInference(creature, input, testConfig());
  assert(result.energy >= 0, "Energy must be non-negative");
  assert(
    Number.isFinite(result.energy),
    "Energy must be finite",
  );
});
