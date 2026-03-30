/**
 * ProductionScale.ts — Production-scale creature backpropagation convergence
 * validation.
 *
 * Issue #1875 — Validates that backpropagation converges on a creature matching
 * production scale (~1,000+ neurons, ~18,000+ synapses) with diverse squash
 * functions, aggregate neurons (IF, MAXIMUM, MINIMUM), and multiple layers of
 * depth.
 *
 * This test serves as a regression guard for future changes to backpropagation,
 * ensuring we never regress on large creature performance.
 */

import { assert, assertGreater, assertLess } from "@std/assert";
import { Creature } from "@creature";
import { train } from "../../TrainTestOnlyUtil.ts";
import {
  AGGREGATE_SQUASHES,
  calculateMSE,
  createSeededRng,
  generateProductionCreature,
  generateTrainingData,
} from "./ProductionScaleCreature.ts";

// ---------------------------------------------------------------------------
// Test 1: Production-scale creature generation and structure validation
// ---------------------------------------------------------------------------

Deno.test("production-scale: creature meets target dimensions", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);
  creature.validate();

  assertGreater(
    creature.neurons.length,
    1000,
    `Should have 1000+ neurons, got ${creature.neurons.length}`,
  );
  assertGreater(
    creature.synapses.length,
    18000,
    `Should have 18000+ synapses, got ${creature.synapses.length}`,
  );

  // Verify diverse squash functions are present
  const squashSet = new Set<string>();
  for (const neuron of creature.neurons) {
    if (neuron.squash) squashSet.add(neuron.squash);
  }

  // Should have at least 10 distinct squash functions
  assertGreater(
    squashSet.size,
    10,
    `Should have diverse squash functions, got ${squashSet.size}: ${
      [...squashSet].join(", ")
    }`,
  );

  // Should include aggregate functions
  const hasAggregate = [...squashSet].some((s) =>
    AGGREGATE_SQUASHES.includes(s)
  );
  assert(
    hasAggregate,
    "Should include aggregate squash functions (IF/MAXIMUM/MINIMUM)",
  );
});

// ---------------------------------------------------------------------------
// Test 2: Backpropagation convergence — error decreases over iterations
// ---------------------------------------------------------------------------

Deno.test("production-scale: backprop converges with normalised gradients", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  const dataRng = createSeededRng(123);
  const trainingData = generateTrainingData(10, 3, 50, dataRng);

  const initialError = calculateMSE(creature, trainingData);

  const results = train(creature, trainingData, {
    targetError: 0.01,
    iterations: 10,
    learningRate: 0.1,
    disableRandomSamples: true,
    generations: 1,
    maximumBiasAdjustmentScale: 1,
    maximumWeightAdjustmentScale: 1,
    normaliseGradients: true,
    sparseRatio: 1,
  });

  // Error should decrease (convergence)
  assertLess(
    results.error,
    initialError,
    `Training error should decrease: initial=${initialError.toFixed(6)}, ` +
      `final=${results.error.toFixed(6)}`,
  );

  // Verify the creature is still valid after training
  creature.validate();

  // Verify no NaN/Infinity in weights and biases
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Synapse weight must be finite after training, got ${synapse.weight}`,
    );
  }
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input" && neuron.type !== "constant") {
      assert(
        Number.isFinite(neuron.bias),
        `Neuron bias must be finite after training, got ${neuron.bias}`,
      );
    }
  }

  // Verify activations produce finite output
  for (const sample of trainingData.slice(0, 5)) {
    const output = creature.activate(new Float32Array(sample.input));
    for (let i = 0; i < output.length; i++) {
      assert(
        Number.isFinite(output[i]),
        `Output must be finite after training, got ${output[i]}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Test 3: Convergence comparison — normaliseGradients true vs false
// ---------------------------------------------------------------------------

Deno.test("production-scale: normalised vs unnormalised gradient convergence comparison", () => {
  const dataRng = createSeededRng(123);
  const trainingData = generateTrainingData(10, 3, 50, dataRng);

  const commonOptions = {
    targetError: 0.01,
    iterations: 8,
    learningRate: 0.1,
    disableRandomSamples: true,
    generations: 1,
    maximumBiasAdjustmentScale: 1,
    maximumWeightAdjustmentScale: 1,
    sparseRatio: 1,
  };

  // Train with normaliseGradients: false (old behaviour)
  const rngA = createSeededRng(42);
  const jsonA = generateProductionCreature(10, 3, rngA);
  const creatureA = Creature.fromJSON(jsonA);
  const initialErrorA = calculateMSE(creatureA, trainingData);

  const resultsOld = train(creatureA, trainingData, {
    ...commonOptions,
    normaliseGradients: false,
  });

  // Train with normaliseGradients: true (new behaviour)
  const rngB = createSeededRng(42);
  const jsonB = generateProductionCreature(10, 3, rngB);
  const creatureB = Creature.fromJSON(jsonB);
  const initialErrorB = calculateMSE(creatureB, trainingData);

  const resultsNew = train(creatureB, trainingData, {
    ...commonOptions,
    normaliseGradients: true,
  });

  // Both should start from the same initial error (same seed)
  const initialDiff = Math.abs(initialErrorA - initialErrorB);
  assertLess(
    initialDiff,
    0.001,
    `Initial errors should match (same seed): A=${initialErrorA}, B=${initialErrorB}`,
  );

  // Both should converge (error should decrease)
  assertLess(
    resultsOld.error,
    initialErrorA,
    `Old config should converge: initial=${initialErrorA}, final=${resultsOld.error}`,
  );
  assertLess(
    resultsNew.error,
    initialErrorB,
    `New config should converge: initial=${initialErrorB}, final=${resultsNew.error}`,
  );

  // Both creatures should remain valid
  creatureA.validate();
  creatureB.validate();

  // Document the comparison (logged for diagnostics, not asserted)
  const reductionOld = 1 - (resultsOld.error / initialErrorA);
  const reductionNew = 1 - (resultsNew.error / initialErrorB);
  console.log(
    `Convergence comparison:`,
    `\n  Old (normaliseGradients=false): error ${initialErrorA.toFixed(4)} → ${
      resultsOld.error.toFixed(4)
    } (${(reductionOld * 100).toFixed(1)}% reduction)`,
    `\n  New (normaliseGradients=true):  error ${initialErrorB.toFixed(4)} → ${
      resultsNew.error.toFixed(4)
    } (${(reductionNew * 100).toFixed(1)}% reduction)`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: No non-finite values during multi-iteration training
// ---------------------------------------------------------------------------

Deno.test("production-scale: weights and biases remain finite across iterations", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  const dataRng = createSeededRng(456);
  const trainingData = generateTrainingData(10, 3, 30, dataRng);

  // Run 5 single-iteration training passes, checking finiteness each time
  for (let iteration = 0; iteration < 5; iteration++) {
    train(creature, trainingData, {
      targetError: 0.01,
      iterations: 1,
      learningRate: 0.1,
      disableRandomSamples: true,
      generations: iteration,
      maximumBiasAdjustmentScale: 1,
      maximumWeightAdjustmentScale: 1,
      normaliseGradients: true,
      sparseRatio: 1,
    });

    // Check all weights are finite
    for (const synapse of creature.synapses) {
      assert(
        Number.isFinite(synapse.weight),
        `Synapse weight non-finite at iteration ${iteration}: ${synapse.weight}`,
      );
    }

    // Check all biases are finite
    for (const neuron of creature.neurons) {
      if (neuron.type !== "input" && neuron.type !== "constant") {
        assert(
          Number.isFinite(neuron.bias),
          `Neuron bias non-finite at iteration ${iteration}: ${neuron.bias}`,
        );
      }
    }

    // Check activations produce finite output
    const sample = trainingData[iteration % trainingData.length];
    const output = creature.activate(new Float32Array(sample.input));
    for (let i = 0; i < output.length; i++) {
      assert(
        Number.isFinite(output[i]),
        `Output non-finite at iteration ${iteration}: ${output[i]}`,
      );
    }
  }
});
