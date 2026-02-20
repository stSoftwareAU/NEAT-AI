/**
 * Tests for Predictive Coding inference (settling) engine.
 * Issue #1554: Predictive Coding inference engine.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { runInference } from "../../src/predictiveCoding/PredictiveCodingInference.ts";
import type { RequiredPredictiveCodingConfig } from "../../src/config/PredictiveCodingConfig.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";

/**
 * Helper: creates a simple 2-input, 1-hidden, 1-output creature with IDENTITY squash.
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
 * Helper: default config with customisable overrides.
 */
function makeConfig(
  overrides: Partial<RequiredPredictiveCodingConfig> = {},
): RequiredPredictiveCodingConfig {
  return { ...DEFAULT_PREDICTIVE_CODING_CONFIG, ...overrides, enabled: true };
}

Deno.test(
  "PredictiveCodingInference: energy decreases monotonically with targets",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);

    // Provide a target that differs from the forward-pass prediction
    // to create non-zero initial energy that inference must reduce.
    const targets = new Float64Array([0.2]);

    const config = makeConfig({
      inferenceSteps: 100,
      inferenceRate: 0.05,
      energyThreshold: 0,
    });

    const result = runInference(creature, input, config, targets);

    // Initial energy should be non-zero because target != prediction.
    assert(
      result.energyHistory[0] > 0,
      "Initial energy should be non-zero when target differs from prediction",
    );

    // Energy should decrease (or stay equal) over iterations.
    for (let i = 1; i < result.energyHistory.length; i++) {
      assert(
        result.energyHistory[i] <= result.energyHistory[i - 1] + 1e-12,
        `Energy increased at step ${i}: ${result.energyHistory[i]} > ${
          result.energyHistory[i - 1]
        }`,
      );
    }

    // Final energy should be less than initial energy.
    assert(
      result.finalEnergy < result.energyHistory[0],
      "Final energy should be less than initial energy",
    );
  },
);

Deno.test(
  "PredictiveCodingInference: early stopping when energy below threshold",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);

    const config = makeConfig({
      inferenceSteps: 1000,
      inferenceRate: 0.05,
      energyThreshold: 1e-4,
    });

    const result = runInference(creature, input, config);

    // Should have converged before using all 1000 steps.
    assert(
      result.stepsUsed < 1000,
      `Expected early stopping but used all ${result.stepsUsed} steps`,
    );

    assert(result.converged, "Should report convergence");
    assert(
      result.finalEnergy <= 1e-4,
      `Final energy ${result.finalEnergy} should be below threshold`,
    );
  },
);

Deno.test(
  "PredictiveCodingInference: does not modify creature topology",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);

    const neuronCountBefore = creature.neurons.length;
    const synapseCountBefore = creature.synapses.length;
    const weightsBefore = creature.synapses.map((s) => s.weight);

    const config = makeConfig({ inferenceSteps: 50 });
    runInference(creature, input, config);

    assertEquals(creature.neurons.length, neuronCountBefore);
    assertEquals(creature.synapses.length, synapseCountBefore);
    for (let i = 0; i < creature.synapses.length; i++) {
      assertEquals(
        creature.synapses[i].weight,
        weightsBefore[i],
        `Weight of synapse ${i} should not change during inference`,
      );
    }
  },
);

Deno.test(
  "PredictiveCodingInference: input neurons remain clamped throughout",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);

    const config = makeConfig({ inferenceSteps: 50 });
    const result = runInference(creature, input, config);

    // Input latent values should be unchanged.
    assertAlmostEquals(result.latents[0], 1.0, 1e-10);
    assertAlmostEquals(result.latents[1], 0.5, 1e-10);
  },
);

Deno.test(
  "PredictiveCodingInference: returns prediction errors for non-input neurons",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);

    const config = makeConfig({ inferenceSteps: 50 });
    const result = runInference(creature, input, config);

    // Should have errors for hidden and output neurons only.
    assertEquals(result.predictionErrors.size, 2);
    assert(result.predictionErrors.has(2), "Should have error for hidden");
    assert(result.predictionErrors.has(3), "Should have error for output");
    assert(!result.predictionErrors.has(0), "Should not have error for input0");
    assert(!result.predictionErrors.has(1), "Should not have error for input1");
  },
);

Deno.test(
  "PredictiveCodingInference: no hidden neurons — no settling needed",
  () => {
    const creature = Creature.fromJSON({
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
    const input = new Float32Array([1.0, 0.5]);

    const config = makeConfig({ inferenceSteps: 50 });
    const result = runInference(creature, input, config);

    // With no hidden neurons to settle, energy should be computed
    // but there is nothing to optimise. The output error should
    // reflect the mismatch between the output latent (initialised
    // from prediction) and the prediction itself, which is zero.
    assert(result.finalEnergy >= 0, "Energy should be non-negative");
    assertEquals(result.predictionErrors.size, 1);
  },
);

Deno.test(
  "PredictiveCodingInference: single hidden neuron converges correctly",
  () => {
    // Simple 1-input, 1-hidden, 1-output with IDENTITY.
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "IDENTITY", index: 1 },
        { type: "output", bias: 0.0, squash: "IDENTITY", index: 2 },
      ],
      synapses: [
        { from: 0, to: 1, weight: 1.0 },
        { from: 1, to: 2, weight: 1.0 },
      ],
      input: 1,
      output: 1,
    });
    const input = new Float32Array([0.8]);

    const config = makeConfig({
      inferenceSteps: 200,
      inferenceRate: 0.1,
      energyThreshold: 1e-8,
    });

    const result = runInference(creature, input, config);

    // With IDENTITY squash and unit weights, the hidden neuron should
    // converge to match the input value (0.8) since prediction = 1.0 * input.
    assert(result.converged, "Should converge");
    assert(
      result.finalEnergy < 1e-8,
      `Final energy ${result.finalEnergy} should be very small`,
    );
  },
);

Deno.test(
  "PredictiveCodingInference: stores inference state in NeuronState",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);

    const config = makeConfig({ inferenceSteps: 20 });
    const result = runInference(creature, input, config);

    // Verify that NeuronState PC fields are populated.
    for (const [idx, nodeState] of result.predictionErrors) {
      const neuronState = creature.state.node(idx);
      assertEquals(neuronState.prediction, nodeState.prediction);
      assertEquals(neuronState.predictionError, nodeState.error);
      assertEquals(neuronState.latentValue, nodeState.latent);
    }
  },
);

Deno.test(
  "PredictiveCodingInference: with LOGISTIC squash, energy still decreases",
  () => {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", bias: 0.0, squash: "LOGISTIC", index: 2 },
        { type: "output", bias: 0.0, squash: "LOGISTIC", index: 3 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5 },
        { from: 1, to: 2, weight: 0.5 },
        { from: 2, to: 3, weight: 1.0 },
      ],
      input: 2,
      output: 1,
    });
    const input = new Float32Array([0.8, 0.3]);

    const config = makeConfig({
      inferenceSteps: 100,
      inferenceRate: 0.05,
      energyThreshold: 0,
    });

    const result = runInference(creature, input, config);

    // Energy should decrease monotonically (within numerical tolerance).
    for (let i = 1; i < result.energyHistory.length; i++) {
      assert(
        result.energyHistory[i] <= result.energyHistory[i - 1] + 1e-10,
        `Energy increased at step ${i}: ${result.energyHistory[i]} > ${
          result.energyHistory[i - 1]
        }`,
      );
    }
  },
);

Deno.test(
  "PredictiveCodingInference: with target outputs, output error reflects target mismatch",
  () => {
    const creature = createSimpleCreature();
    const input = new Float32Array([1.0, 0.5]);
    const targets = new Float64Array([0.42]);

    const config = makeConfig({
      inferenceSteps: 200,
      inferenceRate: 0.1,
      energyThreshold: 1e-8,
    });

    const result = runInference(creature, input, config, targets);

    // The output neuron (last neuron, index 3) should have its latent
    // clamped to the target value.
    assertAlmostEquals(result.latents[3], 0.42, 1e-10);
  },
);
