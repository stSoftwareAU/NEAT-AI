/**
 * Tests for Predictive Coding prediction error computation.
 * Issue #1554: Predictive Coding inference engine.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  computePrediction,
  computePredictionErrors,
  computeTotalEnergy,
} from "../../src/predictiveCoding/PredictionErrorComputation.ts";
import type { PredictionNodeState } from "@architecture/PredictionNodeState.ts";

/**
 * Helper: creates a simple 2-input, 1-hidden, 1-output creature.
 *
 * Topology (internal indices):
 *   input0 (idx 0) --w=0.5--> hidden (idx 2) --w=0.8--> output (idx 3)
 *   input1 (idx 1) --w=0.3--> hidden (idx 2)
 */
function createSimpleCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0.1, squash: "IDENTITY", index: 2 },
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 1, to: 2, weight: 0.3 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });
}

/**
 * Helper: creates a creature with no hidden neurons (input direct to output).
 */
function createNoHiddenCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 2 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 1.0 },
    ],
    input: 2,
    output: 1,
  });
}

Deno.test(
  "PredictionErrorComputation: computePrediction for neuron with IDENTITY squash",
  () => {
    const creature = createSimpleCreature();

    // Set up latent values: input0=1.0, input1=0.5, hidden=0.7, output=0.9
    const latents = new Float64Array(creature.neurons.length);
    latents[0] = 1.0; // input0
    latents[1] = 0.5; // input1
    latents[2] = 0.7; // hidden
    latents[3] = 0.9; // output

    // Prediction for the hidden neuron (index 2):
    // inward connections: from input0 (w=0.5), from input1 (w=0.3)
    // prediction = IDENTITY(0.5*1.0 + 0.3*0.5 + bias=0.1) = 0.5 + 0.15 + 0.1 = 0.75
    const prediction = computePrediction(creature, 2, latents);
    assertAlmostEquals(prediction, 0.75, 1e-10);
  },
);

Deno.test(
  "PredictionErrorComputation: computePrediction for output neuron",
  () => {
    const creature = createSimpleCreature();

    const latents = new Float64Array(creature.neurons.length);
    latents[0] = 1.0;
    latents[1] = 0.5;
    latents[2] = 0.7;
    latents[3] = 0.9;

    // Prediction for the output neuron (index 3):
    // inward connections: from hidden (w=0.8)
    // prediction = IDENTITY(0.8*0.7 + bias=0.0) = 0.56
    const prediction = computePrediction(creature, 3, latents);
    assertAlmostEquals(prediction, 0.56, 1e-10);
  },
);

Deno.test(
  "PredictionErrorComputation: computePrediction with non-linear squash",
  () => {
    // Create a creature with LOGISTIC squash on hidden neuron.
    // With input:1, indices are: 0=input, 1=hidden, 2=output.
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "LOGISTIC", index: 1 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 2 },
      ],
      synapses: [
        { from: 0, to: 1, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    });

    const latents = new Float64Array(creature.neurons.length);
    latents[0] = 0.0; // input
    latents[1] = 0.5; // hidden
    latents[2] = 0.5; // output

    // Prediction for hidden (index 1):
    // LOGISTIC(1.0*0.0 + 0.0) = LOGISTIC(0) = 0.5
    const prediction = computePrediction(creature, 1, latents);
    assertAlmostEquals(prediction, 0.5, 1e-6);
  },
);

Deno.test(
  "PredictionErrorComputation: computePredictionErrors returns per-neuron errors",
  () => {
    const creature = createSimpleCreature();

    const latents = new Float64Array(creature.neurons.length);
    latents[0] = 1.0;
    latents[1] = 0.5;
    latents[2] = 0.7;
    latents[3] = 0.9;

    const nodeStates = computePredictionErrors(creature, latents);

    // Should have entries for hidden and output neurons, not inputs
    assertEquals(nodeStates.size, 2);

    // Hidden neuron (index 2): prediction = 0.75, error = 0.7 - 0.75 = -0.05
    const hiddenState = nodeStates.get(2);
    assert(hiddenState !== undefined);
    assertAlmostEquals(hiddenState!.prediction, 0.75, 1e-10);
    assertAlmostEquals(hiddenState!.error, -0.05, 1e-10);
    assertAlmostEquals(hiddenState!.latent, 0.7, 1e-10);

    // Output neuron (index 3): prediction = 0.56, error = 0.9 - 0.56 = 0.34
    const outputState = nodeStates.get(3);
    assert(outputState !== undefined);
    assertAlmostEquals(outputState!.prediction, 0.56, 1e-10);
    assertAlmostEquals(outputState!.error, 0.34, 1e-10);
    assertAlmostEquals(outputState!.latent, 0.9, 1e-10);
  },
);

Deno.test(
  "PredictionErrorComputation: computeTotalEnergy sums squared errors",
  () => {
    const nodeStates = new Map<number, PredictionNodeState>();
    nodeStates.set(2, { prediction: 0.75, error: -0.05, latent: 0.7 });
    nodeStates.set(3, { prediction: 0.56, error: 0.34, latent: 0.9 });

    // Energy = 0.5 * ((-0.05)^2 + (0.34)^2)
    //        = 0.5 * (0.0025 + 0.1156)
    //        = 0.5 * 0.1181
    //        = 0.05905
    const energy = computeTotalEnergy(nodeStates);
    assertAlmostEquals(energy, 0.05905, 1e-10);
  },
);

Deno.test(
  "PredictionErrorComputation: no hidden neurons produces only output errors",
  () => {
    const creature = createNoHiddenCreature();

    const latents = new Float64Array(creature.neurons.length);
    latents[0] = 1.0;
    latents[1] = 0.5;
    latents[2] = 0.8; // output

    const nodeStates = computePredictionErrors(creature, latents);

    // Only the output neuron should have errors
    assertEquals(nodeStates.size, 1);

    // Output (index 2): prediction = IDENTITY(1.0*1.0 + 1.0*0.5 + 0.0) = 1.5
    // error = 0.8 - 1.5 = -0.7
    const outputState = nodeStates.get(2);
    assert(outputState !== undefined);
    assertAlmostEquals(outputState!.prediction, 1.5, 1e-10);
    assertAlmostEquals(outputState!.error, -0.7, 1e-10);
  },
);

Deno.test(
  "PredictionErrorComputation: zero errors give zero energy",
  () => {
    const nodeStates = new Map<number, PredictionNodeState>();
    nodeStates.set(2, { prediction: 0.5, error: 0.0, latent: 0.5 });
    nodeStates.set(3, { prediction: 0.8, error: 0.0, latent: 0.8 });

    const energy = computeTotalEnergy(nodeStates);
    assertEquals(energy, 0);
  },
);

Deno.test(
  "PredictionErrorComputation: computePrediction for input neuron returns latent",
  () => {
    const creature = createSimpleCreature();

    const latents = new Float64Array(creature.neurons.length);
    latents[0] = 1.0;
    latents[1] = 0.5;

    // Input neurons have no inward connections, so prediction = latent value
    const prediction = computePrediction(creature, 0, latents);
    assertEquals(prediction, 1.0);
  },
);
