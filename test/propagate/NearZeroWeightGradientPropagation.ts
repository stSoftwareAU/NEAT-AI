/**
 * Tests for near-zero weight error propagation stability.
 *
 * Issue #1873 - When a synapse weight is near zero, dividing by the effective
 * weight (plankConstant ≈ 1e-7) produces extreme targetFromActivation values
 * that fall outside the squash function's range. Previously these were silently
 * dropped, creating dead gradient paths. The fix clamps out-of-range targets
 * to the range boundary so a reduced gradient still propagates.
 */

import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test("NearZeroWeightGradient - clamped gradient propagates through near-zero weight with TANH", () => {
  // Network: Input → Hidden (TANH, weight=1e-10) → Output (IDENTITY)
  // With TANH range [-1, 1], dividing by effective weight 1e-7 produces
  // targetFromActivation ≈ 100,000 which is far outside [-1, 1].
  // Previously this was dropped entirely. Now it should be clamped to the
  // range boundary so gradient still flows upstream.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      // Near-zero weight creates the dead gradient path
      { fromUUID: "h1", toUUID: "output-0", weight: 1e-10 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportInternalJSON(), config);

  const input = new Float32Array([0.5]);
  const target = new Float32Array([0.5]);

  const initialResult = creature.activate(input);
  const initialError = Math.abs(initialResult[0] - target[0]);

  // Train — with clamped gradient, the hidden neuron should receive
  // gradient signal even through the near-zero weight connection.
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < 50; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);
  }

  const finalResult = creature.activate(input);
  const finalError = Math.abs(finalResult[0] - target[0]);

  // Error should decrease — gradient must have propagated through the
  // near-zero weight connection via clamped targets.
  assert(
    finalError < initialError,
    `Error should decrease with clamped gradient propagation: initial=${initialError}, final=${finalError}`,
  );
});

Deno.test("NearZeroWeightGradient - upstream neuron receives gradient through near-zero weight", () => {
  // Two hidden layers where the middle connection has near-zero weight.
  // The upstream hidden neuron (h1) should still receive gradient signal.
  //
  // Network: Input → H1 (TANH) → H2 (TANH, weight=1e-10) → Output (IDENTITY)
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "h2", weight: 1e-10 }, // Near-zero weight
      { fromUUID: "h2", toUUID: "output-0", weight: 0.8 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportInternalJSON(), config);

  const input = new Float32Array([0.7]);
  const target = new Float32Array([0.4]);

  // Record the initial bias of h1 to detect if gradient reached it.
  const initialH1Bias = creature.neurons[1].bias; // h1 is at index 1 (after input)

  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = 0; i < 50; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);
  }

  // h1's bias should have changed — meaning gradient propagated
  // through the near-zero weight h1→h2 connection.
  const updatedH1Bias = creature.neurons[1].bias;
  assert(
    Math.abs(updatedH1Bias - initialH1Bias) > 1e-10,
    `H1 bias should change from gradient through near-zero weight: initial=${initialH1Bias}, updated=${updatedH1Bias}`,
  );
});

Deno.test("NearZeroWeightGradient - no non-finite values from clamped propagation", () => {
  // Ensure that clamping near-zero weight targets does not introduce
  // NaN or Infinity values. This maintains Issue #1314 protections.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1e-10 },
      { fromUUID: "input-1", toUUID: "h2", weight: 0.5 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1e-10 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportInternalJSON(), config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.4]);

  // Train extensively — all values must remain finite.
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = 0; i < 100; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);
  }

  const result = creature.activate(input);
  assert(
    Number.isFinite(result[0]),
    `Output should be finite, got ${result[0]}`,
  );

  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Synapse weight should be finite, got ${synapse.weight}`,
    );
  }

  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      assert(
        Number.isFinite(neuron.bias),
        `Neuron bias should remain finite, got ${neuron.bias}`,
      );
    }
  }
});

Deno.test("NearZeroWeightGradient - multiple near-zero weights do not block all gradient paths", () => {
  // Network with several near-zero weight connections to simulate
  // the large creature scenario where many synapses have near-zero weights.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1e-10 }, // Near-zero
      { fromUUID: "input-1", toUUID: "h2", weight: 1e-10 }, // Near-zero
      { fromUUID: "h1", toUUID: "h3", weight: 1e-10 }, // Near-zero
      { fromUUID: "h2", toUUID: "h3", weight: 1e-10 }, // Near-zero
      { fromUUID: "h3", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportInternalJSON(), config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.3]);

  const initialResult = creature.activate(input);
  const initialError = Math.abs(initialResult[0] - target[0]);

  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = 0; i < 50; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);
  }

  const finalResult = creature.activate(input);
  const finalError = Math.abs(finalResult[0] - target[0]);

  // With clamped gradient propagation, training should still make progress
  // even when most paths have near-zero weights.
  assert(
    finalError < initialError,
    `Error should decrease even with multiple near-zero weight paths: initial=${initialError}, final=${finalError}`,
  );
});
