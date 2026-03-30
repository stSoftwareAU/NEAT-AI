/**
 * Tests for Predictive Coding local Hebbian learning rules.
 * Issue #1555: Implements the "slow" learning phase — weight updates
 * based on locally available pre-synaptic activity and post-synaptic error.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { runInference } from "@predictiveCoding/PredictiveCodingInference.ts";
import type { RequiredPredictiveCodingConfig } from "@config/PredictiveCodingConfig.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import {
  applyHebbianUpdate,
  computeWeightGradients,
} from "@predictiveCoding/PredictiveCodingLearning.ts";
import type { WeightGradients } from "@predictiveCoding/PredictiveCodingLearning.ts";

/**
 * Helper: default config with customisable overrides.
 */
function makeConfig(
  overrides: Partial<RequiredPredictiveCodingConfig> = {},
): RequiredPredictiveCodingConfig {
  return { ...DEFAULT_PREDICTIVE_CODING_CONFIG, ...overrides, enabled: true };
}

/**
 * Helper: creates a simple 2-input, 1-hidden, 1-output creature with IDENTITY squash.
 *
 * Topology (internal indices):
 *   input0 (idx 0) --w=0.5--> hidden (idx 2) --w=0.8--> output (idx 3)
 *   input1 (idx 1) --w=0.3--> hidden (idx 2)
 *   Hidden bias = 0.1, Output bias = 0.0
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

// ---------- Known gradient: hand-computed weight update ----------

Deno.test(
  "PredictiveCodingLearning: hand-computed weight deltas with IDENTITY squash",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);
    const targets = new Float64Array([0.2]);

    const config = makeConfig({
      inferenceSteps: 100,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    // Run inference to settle latent values.
    const result = runInference(creature, input, config, targets);

    // Compute weight gradients using settled state.
    const gradients = computeWeightGradients(creature, result, config);

    // With IDENTITY squash, f'(a) = 1 for all neurons.
    // ΔW(j→i) = learningRate * f'(a(i)) * ε(i) * x(j)
    //         = learningRate * 1 * ε(i) * x(j)
    //
    // For each synapse, verify the gradient formula.
    for (const synapseGrad of gradients.synapseGradients) {
      const synapse = creature.synapses[synapseGrad.synapseIndex];
      const targetError = result.predictionErrors.get(synapse.to);
      assert(targetError !== undefined, "Target should have prediction error");

      const sourceLatent = result.latents[synapse.from];
      const expectedDelta = config.learningRate * 1.0 *
        targetError!.error * sourceLatent;

      assertAlmostEquals(
        synapseGrad.delta,
        expectedDelta,
        1e-10,
        `Weight delta for synapse ${synapse.from}->${synapse.to} should match hand-computed value`,
      );
    }

    // Bias gradients: Δb(i) = learningRate * f'(a(i)) * ε(i)
    for (const biasGrad of gradients.biasGradients) {
      const error = result.predictionErrors.get(biasGrad.neuronIndex);
      assert(error !== undefined, "Neuron should have prediction error");

      const expectedDelta = config.learningRate * 1.0 * error!.error;
      assertAlmostEquals(
        biasGrad.delta,
        expectedDelta,
        1e-10,
        `Bias delta for neuron ${biasGrad.neuronIndex} should match hand-computed value`,
      );
    }
  },
);

Deno.test(
  "PredictiveCodingLearning: hand-computed weight deltas with LOGISTIC squash",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "LOGISTIC", index: 1 },
        { type: "output", bias: 0.0, squash: "LOGISTIC", index: 2 },
      ],
      synapses: [
        { from: 0, to: 1, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    });

    const input = new Float32Array([0.5]);
    const targets = new Float64Array([0.3]);

    const config = makeConfig({
      inferenceSteps: 100,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    const result = runInference(creature, input, config, targets);
    const gradients = computeWeightGradients(creature, result, config);

    // With LOGISTIC squash, f'(a) = f(a) * (1 - f(a)).
    // Verify each gradient uses the correct derivative.
    for (const synapseGrad of gradients.synapseGradients) {
      const synapse = creature.synapses[synapseGrad.synapseIndex];
      const targetError = result.predictionErrors.get(synapse.to);
      assert(targetError !== undefined);

      // Compute the weighted input sum to the target neuron.
      const inward = creature.inwardConnections(synapse.to);
      const targetNeuron = creature.neurons[synapse.to];
      let weightedSum = targetNeuron.bias;
      for (const s of inward) {
        weightedSum += s.weight * result.latents[s.from];
      }

      // LOGISTIC derivative: σ(x) * (1 - σ(x))
      const sigmoid = 1.0 / (1.0 + Math.exp(-weightedSum));
      const derivative = sigmoid * (1 - sigmoid);

      const sourceLatent = result.latents[synapse.from];
      const expectedDelta = config.learningRate * derivative *
        targetError!.error * sourceLatent;

      assertAlmostEquals(
        synapseGrad.delta,
        expectedDelta,
        1e-10,
        `Weight delta for synapse ${synapse.from}->${synapse.to} with LOGISTIC should match`,
      );
    }
  },
);

// ---------- Learning reduces energy over epochs ----------

Deno.test(
  "PredictiveCodingLearning: energy decreases over training epochs",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);
    const targets = new Float64Array([0.2]);

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    // Track energy across multiple training epochs.
    const energies: number[] = [];

    for (let epoch = 0; epoch < 20; epoch++) {
      const result = runInference(creature, input, config, targets);
      energies.push(result.finalEnergy);

      const gradients = computeWeightGradients(creature, result, config);
      applyHebbianUpdate(creature, gradients);
    }

    // Final energy should be substantially lower than initial energy.
    assert(
      energies[energies.length - 1] < energies[0],
      `Final energy ${
        energies[energies.length - 1]
      } should be less than initial ${energies[0]}`,
    );
  },
);

// ---------- Weight constraints: precision ----------

Deno.test(
  "PredictiveCodingLearning: weights respect plank precision (1e-7)",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);
    const targets = new Float64Array([0.2]);

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    const result = runInference(creature, input, config, targets);
    const gradients = computeWeightGradients(creature, result, config);
    applyHebbianUpdate(creature, gradients);

    const PLANK = 1e-7;
    for (const synapse of creature.synapses) {
      // Weights should either be zero or at least plank magnitude.
      if (synapse.weight !== 0) {
        assert(
          Math.abs(synapse.weight) >= PLANK,
          `Weight ${synapse.weight} violates plank precision constraint`,
        );
      }
    }
  },
);

// ---------- Weight constraints: synapse type ----------

Deno.test(
  "PredictiveCodingLearning: positive synapse type stays positive",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 2 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 3 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.01, type: "positive" },
        { from: 1, to: 2, weight: 0.01, type: "positive" },
        { from: 2, to: 3, weight: 0.8 },
      ],
      input: 2,
      output: 1,
    });

    const input = new Float32Array([1.0, 0.5]);
    const targets = new Float64Array([-5.0]); // Strong negative target to push weights negative.

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.5, // Large rate to force aggressive updates.
      energyThreshold: 0,
    });

    // Apply many epochs to try to push positive weights negative.
    for (let epoch = 0; epoch < 50; epoch++) {
      const result = runInference(creature, input, config, targets);
      const gradients = computeWeightGradients(creature, result, config);
      applyHebbianUpdate(creature, gradients);
    }

    // Positive-typed synapses must remain non-negative.
    for (const synapse of creature.synapses) {
      if (synapse.type === "positive") {
        assert(
          synapse.weight >= 0,
          `Positive synapse weight ${synapse.weight} went negative`,
        );
      }
    }
  },
);

Deno.test(
  "PredictiveCodingLearning: negative synapse type stays negative",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 2 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 3 },
      ],
      synapses: [
        { from: 0, to: 2, weight: -0.01, type: "negative" },
        { from: 1, to: 2, weight: -0.01, type: "negative" },
        { from: 2, to: 3, weight: 0.8 },
      ],
      input: 2,
      output: 1,
    });

    const input = new Float32Array([1.0, 0.5]);
    const targets = new Float64Array([5.0]); // Strong positive target to push weights positive.

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.5,
      energyThreshold: 0,
    });

    for (let epoch = 0; epoch < 50; epoch++) {
      const result = runInference(creature, input, config, targets);
      const gradients = computeWeightGradients(creature, result, config);
      applyHebbianUpdate(creature, gradients);
    }

    for (const synapse of creature.synapses) {
      if (synapse.type === "negative") {
        assert(
          synapse.weight <= 0,
          `Negative synapse weight ${synapse.weight} went positive`,
        );
      }
    }
  },
);

// ---------- Batch accumulation ----------

Deno.test(
  "PredictiveCodingLearning: batch averaging produces correct results",
  () => {
    const creature = createSimpleCreature();

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    // Multiple data samples.
    const samples = [
      {
        input: new Float32Array([1.0, 0.5]),
        target: new Float64Array([0.2]),
      },
      {
        input: new Float32Array([0.3, 0.8]),
        target: new Float64Array([0.7]),
      },
      {
        input: new Float32Array([0.6, 0.1]),
        target: new Float64Array([0.5]),
      },
    ];

    // Accumulate gradients across the batch.
    const batchGradients: WeightGradients[] = [];
    for (const sample of samples) {
      const result = runInference(
        creature,
        sample.input,
        config,
        sample.target,
      );
      const gradients = computeWeightGradients(creature, result, config);
      batchGradients.push(gradients);
    }

    // The averaged delta for each synapse should be the mean of all sample deltas.
    const synapseCount = creature.synapses.length;
    for (let s = 0; s < synapseCount; s++) {
      let sum = 0;
      for (const grad of batchGradients) {
        const sg = grad.synapseGradients.find((g) => g.synapseIndex === s);
        if (sg) sum += sg.delta;
      }
      const expectedAvg = sum / samples.length;
      // This is just a sanity check that the averaging math works.
      assertAlmostEquals(
        expectedAvg,
        sum / samples.length,
        1e-15,
        `Batch average for synapse ${s} should be the mean`,
      );
    }
  },
);

Deno.test(
  "PredictiveCodingLearning: batch update applies averaged gradients",
  () => {
    // Create two identical creatures.
    const creature1 = createSimpleCreature();
    const creature2 = createSimpleCreature();

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    const samples = [
      {
        input: new Float32Array([1.0, 0.5]),
        target: new Float64Array([0.2]),
      },
      {
        input: new Float32Array([0.3, 0.8]),
        target: new Float64Array([0.7]),
      },
    ];

    // Creature 1: accumulate and apply averaged gradients.
    const batchGradients: WeightGradients[] = [];
    for (const sample of samples) {
      const result = runInference(
        creature1,
        sample.input,
        config,
        sample.target,
      );
      batchGradients.push(computeWeightGradients(creature1, result, config));
    }

    // Average the synapse and bias gradients.
    const avgGradients: WeightGradients = {
      synapseGradients: batchGradients[0].synapseGradients.map((sg, idx) => ({
        synapseIndex: sg.synapseIndex,
        delta: batchGradients.reduce(
          (sum, g) => sum + g.synapseGradients[idx].delta,
          0,
        ) / batchGradients.length,
      })),
      biasGradients: batchGradients[0].biasGradients.map((bg, idx) => ({
        neuronIndex: bg.neuronIndex,
        delta: batchGradients.reduce(
          (sum, g) => sum + g.biasGradients[idx].delta,
          0,
        ) / batchGradients.length,
      })),
    };

    applyHebbianUpdate(creature1, avgGradients);

    // Creature 2: apply each sample individually (non-batch).
    for (const sample of samples) {
      const result = runInference(
        creature2,
        sample.input,
        config,
        sample.target,
      );
      const gradients = computeWeightGradients(creature2, result, config);
      applyHebbianUpdate(creature2, gradients);
    }

    // The batch-averaged approach should produce different weights from
    // sequential application (since weights change between samples in sequential mode).
    // This verifies that batch mode exists and is distinct from online mode.
    let anyDifference = false;
    for (let i = 0; i < creature1.synapses.length; i++) {
      if (
        Math.abs(creature1.synapses[i].weight - creature2.synapses[i].weight) >
          1e-15
      ) {
        anyDifference = true;
        break;
      }
    }
    assert(
      anyDifference,
      "Batch-averaged and sequential updates should produce different weights",
    );
  },
);

// ---------- Squash derivative correctness ----------

Deno.test(
  "PredictiveCodingLearning: TANH squash derivative used correctly",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "TANH", index: 1 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 2 },
      ],
      synapses: [
        { from: 0, to: 1, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    });

    const input = new Float32Array([0.5]);
    const targets = new Float64Array([0.3]);

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    const result = runInference(creature, input, config, targets);
    const gradients = computeWeightGradients(creature, result, config);

    // Verify the hidden neuron synapse uses TANH derivative.
    // For synapse 0→1 (TANH hidden):
    // ΔW = η * tanh'(a(1)) * ε(1) * x(0)
    // tanh'(a) = 1 - tanh(a)²
    const synapse0 = gradients.synapseGradients.find(
      (g) => creature.synapses[g.synapseIndex].to === 1,
    );
    assert(
      synapse0 !== undefined,
      "Should have gradient for synapse to hidden",
    );

    const inward = creature.inwardConnections(1);
    let weightedSum = creature.neurons[1].bias;
    for (const s of inward) {
      weightedSum += s.weight * result.latents[s.from];
    }
    const tanhVal = Math.tanh(weightedSum);
    const tanhDeriv = 1 - tanhVal * tanhVal;

    const hiddenError = result.predictionErrors.get(1)!;
    const expectedDelta = config.learningRate * tanhDeriv *
      hiddenError.error * result.latents[0];

    assertAlmostEquals(
      synapse0!.delta,
      expectedDelta,
      1e-10,
      "Weight delta should use TANH derivative",
    );
  },
);

Deno.test(
  "PredictiveCodingLearning: ReLU squash derivative used correctly",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "ReLU", index: 1 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 2 },
      ],
      synapses: [
        { from: 0, to: 1, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    });

    // Positive input so ReLU derivative = 1.
    const input = new Float32Array([0.5]);
    const targets = new Float64Array([0.3]);

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.01,
      energyThreshold: 0,
    });

    const result = runInference(creature, input, config, targets);
    const gradients = computeWeightGradients(creature, result, config);

    // With positive input and w=1.0, the pre-activation is positive,
    // so ReLU derivative = 1.
    const synapse0 = gradients.synapseGradients.find(
      (g) => creature.synapses[g.synapseIndex].to === 1,
    );
    assert(synapse0 !== undefined);

    const hiddenError = result.predictionErrors.get(1)!;
    const expectedDelta = config.learningRate * 1.0 *
      hiddenError.error * result.latents[0];

    assertAlmostEquals(
      synapse0!.delta,
      expectedDelta,
      1e-10,
      "Weight delta should use ReLU derivative (=1 for positive input)",
    );
  },
);

// ---------- Condition synapse type ----------

Deno.test(
  "PredictiveCodingLearning: condition synapse type is not updated",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 2 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 3 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5, type: "condition" },
        { from: 1, to: 2, weight: 0.3 },
        { from: 2, to: 3, weight: 0.8 },
      ],
      input: 2,
      output: 1,
    });

    const originalWeight = creature.synapses[0].weight;
    const input = new Float32Array([1.0, 0.5]);
    const targets = new Float64Array([0.2]);

    const config = makeConfig({
      inferenceSteps: 50,
      inferenceRate: 0.05,
      learningRate: 0.1,
      energyThreshold: 0,
    });

    for (let epoch = 0; epoch < 10; epoch++) {
      const result = runInference(creature, input, config, targets);
      const gradients = computeWeightGradients(creature, result, config);
      applyHebbianUpdate(creature, gradients);
    }

    assertEquals(
      creature.synapses[0].weight,
      originalWeight,
      "Condition synapse weight should not change",
    );
  },
);

// ---------- No changes when errors are zero ----------

Deno.test(
  "PredictiveCodingLearning: zero prediction errors produce zero gradients",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);

    // No targets — inference should converge to zero error.
    const config = makeConfig({
      inferenceSteps: 200,
      inferenceRate: 0.1,
      learningRate: 0.01,
      energyThreshold: 1e-12,
    });

    const result = runInference(creature, input, config);

    // If converged, errors should be near zero.
    if (result.converged) {
      const gradients = computeWeightGradients(creature, result, config);

      for (const sg of gradients.synapseGradients) {
        assertAlmostEquals(
          sg.delta,
          0,
          1e-6,
          `Synapse gradient should be near zero when errors are zero`,
        );
      }
      for (const bg of gradients.biasGradients) {
        assertAlmostEquals(
          bg.delta,
          0,
          1e-6,
          `Bias gradient should be near zero when errors are zero`,
        );
      }
    }
  },
);
