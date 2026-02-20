/**
 * Tests for PredictionErrorComputation module.
 *
 * Issue #1554: Verifies that prediction error computation correctly
 * computes per-neuron predictions, errors, and total energy for
 * arbitrary NEAT topologies.
 */

import { assertAlmostEquals, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import {
  computePrediction,
  computePredictionErrors,
} from "../../src/predictiveCoding/PredictionErrorComputation.ts";

/**
 * Creates a simple 2-input, 1-hidden, 1-output creature with IDENTITY squash.
 * This makes manual calculation straightforward.
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

Deno.test("PredictionError - prediction for identity neuron equals weighted sum", () => {
  const creature = makeSimpleCreature();
  const activations = new Float64Array([1.0, 2.0, 3.0, 3.0]);

  // Hidden neuron (index 2): bias=0, inward from 0 (w=1) and 1 (w=1)
  // prediction = IDENTITY(0 + 1*1 + 1*2) = 3.0
  const prediction = computePrediction(creature, 2, activations);
  assertAlmostEquals(prediction, 3.0, 1e-10);
});

Deno.test("PredictionError - prediction for output neuron uses inward connections", () => {
  const creature = makeSimpleCreature();
  const activations = new Float64Array([1.0, 2.0, 3.0, 5.0]);

  // Output neuron (index 3): bias=0, inward from 2 (w=1)
  // prediction = IDENTITY(0 + 1*3) = 3.0
  const prediction = computePrediction(creature, 3, activations);
  assertAlmostEquals(prediction, 3.0, 1e-10);
});

Deno.test("PredictionError - error is actual minus predicted", () => {
  const creature = makeSimpleCreature();
  // Set activations where hidden neuron actual != predicted
  const activations = new Float64Array([1.0, 2.0, 5.0, 3.0]);

  const result = computePredictionErrors(creature, activations);

  // Hidden neuron (index 2): prediction = 1+2 = 3, actual = 5, error = 5-3 = 2
  assertAlmostEquals(result.errors[2], 2.0, 1e-10);
  // Output neuron (index 3): prediction = 5 (from hidden), actual = 3, error = 3-5 = -2
  assertAlmostEquals(result.errors[3], -2.0, 1e-10);
});

Deno.test("PredictionError - input neurons have zero error", () => {
  const creature = makeSimpleCreature();
  const activations = new Float64Array([1.0, 2.0, 3.0, 3.0]);

  const result = computePredictionErrors(creature, activations);

  assertEquals(result.errors[0], 0);
  assertEquals(result.errors[1], 0);
});

Deno.test("PredictionError - energy is half sum of squared errors", () => {
  const creature = makeSimpleCreature();
  // Hidden: prediction=3, actual=5, error=2
  // Output: prediction=5, actual=3, error=-2
  const activations = new Float64Array([1.0, 2.0, 5.0, 3.0]);

  const result = computePredictionErrors(creature, activations);

  // Energy = 0.5 * (2² + (-2)²) = 0.5 * 8 = 4
  assertAlmostEquals(result.energy, 4.0, 1e-10);
});

Deno.test("PredictionError - zero error when predictions match activations", () => {
  const creature = makeSimpleCreature();
  // Set activations that are consistent with the network
  // input=[1,2], hidden should be 3, output should be 3
  const activations = new Float64Array([1.0, 2.0, 3.0, 3.0]);

  const result = computePredictionErrors(creature, activations);

  assertAlmostEquals(result.errors[2], 0.0, 1e-10);
  assertAlmostEquals(result.errors[3], 0.0, 1e-10);
  assertAlmostEquals(result.energy, 0.0, 1e-10);
});

Deno.test("PredictionError - with targets, output error uses target", () => {
  const creature = makeSimpleCreature();
  const activations = new Float64Array([1.0, 2.0, 3.0, 3.0]);
  const targets = new Float64Array([5.0]); // target for output

  const result = computePredictionErrors(creature, activations, targets);

  // Output (index 3): error = target(5) - prediction(3) = 2
  assertAlmostEquals(result.errors[3], 2.0, 1e-10);
});

Deno.test("PredictionError - works with TANH squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "TANH" },
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
  const activations = new Float64Array([0.5, 0, 0.8, 0.5]);

  const prediction = computePrediction(creature, 2, activations);
  // prediction = tanh(0 + 1*0.5) = tanh(0.5)
  assertAlmostEquals(prediction, Math.tanh(0.5), 1e-10);
});

Deno.test("PredictionError - multiple hidden neurons", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "IDENTITY" },
      { bias: 0, index: 3, type: "hidden", squash: "IDENTITY" },
      { bias: 0, index: 4, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 2 },
      { weight: 1.0, from: 1, to: 3 },
      { weight: 1.0, from: 2, to: 4 },
      { weight: 1.0, from: 3, to: 4 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  // Consistent activations: h1=1, h2=2, out=3
  const activations = new Float64Array([1.0, 2.0, 1.0, 2.0, 3.0]);

  const result = computePredictionErrors(creature, activations);
  assertAlmostEquals(result.errors[2], 0.0, 1e-10);
  assertAlmostEquals(result.errors[3], 0.0, 1e-10);
  assertAlmostEquals(result.errors[4], 0.0, 1e-10);
  assertAlmostEquals(result.energy, 0.0, 1e-10);
});

Deno.test("PredictionError - neuron with bias contributes to prediction", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.5, index: 1, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 2.0, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const activations = new Float64Array([3.0, 10.0]);

  // prediction = 0.5 + 2*3 = 6.5
  const prediction = computePrediction(creature, 1, activations);
  assertAlmostEquals(prediction, 6.5, 1e-10);
});

Deno.test("PredictionError - energy is always non-negative", () => {
  const creature = makeSimpleCreature();
  const activations = new Float64Array([1.0, 2.0, 100.0, -50.0]);

  const result = computePredictionErrors(creature, activations);
  assertGreater(result.energy, 0);
});

Deno.test("PredictionError - no hidden neurons (direct input-to-output)", () => {
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
  const activations = new Float64Array([2.0, 2.0]);

  const result = computePredictionErrors(creature, activations);
  // Output prediction = 1*2 = 2, actual = 2, error = 0
  assertAlmostEquals(result.energy, 0.0, 1e-10);
});
