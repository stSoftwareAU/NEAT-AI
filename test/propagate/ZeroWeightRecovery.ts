/**
 * Tests for zero-weight connection recovery through backpropagation.
 *
 * Issue #1654 - When a synapse weight is near zero, error should still
 * propagate through that connection so backpropagation can recover it.
 * Previously, near-zero weights caused the connection to be permanently
 * skipped, creating "dead connections" that could never recover.
 */

import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test("ZeroWeightRecovery - near-zero weight develops non-zero weight", () => {
  // A network where the hidden→output synapse has near-zero weight.
  // With correct backpropagation, the error signal should still flow
  // through this connection, allowing the weight to recover.
  //
  // Network: Input → Hidden (IDENTITY) → Output (IDENTITY)
  // The hidden→output weight starts at ~0 (1e-10).
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1e-10 }, // Near-zero weight
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
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.8]);

  const originalWeight = creature.synapses[1].weight;
  assert(
    Math.abs(originalWeight) < 1e-7,
    `Initial weight should be near zero, got ${originalWeight}`,
  );

  // Train for several iterations.
  for (let i = 0; i < 50; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  // The near-zero weight should have recovered to a non-trivial value.
  const updatedWeight = creature.synapses[1].weight;
  assert(
    Math.abs(updatedWeight) > 1e-5,
    `Near-zero weight should recover through backprop, got ${updatedWeight}`,
  );
});

Deno.test("ZeroWeightRecovery - error propagates through zero-weight connection", () => {
  // A two-layer network where the input→hidden connection has near-zero weight.
  // Error should still propagate upstream through this connection so the
  // weight can be updated.
  //
  // Network: Input → Hidden (IDENTITY, weight≈0) → Output (IDENTITY, weight=1)
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1e-10 }, // Near-zero weight
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
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
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.8]);

  // Record initial error.
  const initialResult = creature.activate(input);
  const initialError = Math.abs(initialResult[0] - target[0]);

  // Train over multiple apply cycles to allow the weight to grow incrementally.
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = 0; i < 50; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);
  }

  // After training, the input→h1 weight should have recovered from near-zero.
  const updatedWeight = creature.synapses[0].weight;
  assert(
    Math.abs(updatedWeight) > 1e-5,
    `Near-zero input→hidden weight should recover, got ${updatedWeight}`,
  );

  // Output should be closer to target than the initial near-zero output.
  const result = creature.activate(input);
  const finalError = Math.abs(result[0] - target[0]);
  assert(
    finalError < initialError,
    `Error should decrease: initial=${initialError}, final=${finalError}`,
  );
});

Deno.test("ZeroWeightRecovery - no NaN or Infinity from near-zero weights", () => {
  // Ensure that near-zero weights don't produce NaN or Infinity during
  // backpropagation. The division targetFromValue / fromWeight must be
  // handled gracefully.
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
    learningRate: 0.05,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.4]);

  // Train — should not throw and all values should remain finite.
  for (let i = 0; i < 100; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  const result = creature.activate(input);
  assert(
    Number.isFinite(result[0]),
    `Output should be finite, got ${result[0]}`,
  );

  // All synapse weights should be finite.
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Synapse weight should be finite, got ${synapse.weight}`,
    );
  }
});
