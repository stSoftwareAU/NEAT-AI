/**
 * Tests for TopologicalBackpropagation.ts
 *
 * Issue #1641 - Verifies that the topological ordering-based backpropagation
 * produces correct results. Tests that training converges (error decreases)
 * and that weight/bias updates are applied correctly.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test("TopologicalBackpropagation - single neuron convergence", () => {
  // Simple: Input → Output (IDENTITY squash)
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
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
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.8]);

  // Train multiple samples.
  for (let i = 0; i < 10; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  // After training, the output should be closer to the target.
  const result = creature.activate(input);
  const error = Math.abs(result[0] - target[0]);
  assert(error < 0.3, `Error should decrease after training, got ${error}`);
});

Deno.test("TopologicalBackpropagation - multi-layer convergence", () => {
  // Input → H1 → H2 → Output
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.4 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
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
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.4]);

  // Get initial error.
  const initialResult = creature.activate(input);
  const initialError = Math.abs(initialResult[0] - target[0]);

  // Train.
  for (let i = 0; i < 50; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  // Error should decrease.
  const finalResult = creature.activate(input);
  const finalError = Math.abs(finalResult[0] - target[0]);
  assert(
    finalError < initialError,
    `Error should decrease: initial=${initialError}, final=${finalError}`,
  );
});

Deno.test("TopologicalBackpropagation - diamond topology converges", () => {
  // Input → H1 → Output
  //       ↘ H2 ↗
  // Both hidden neurons feed into the same output.
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
      { fromUUID: "input-0", toUUID: "h2", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.4 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
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
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.7]);
  const target = new Float32Array([0.3]);

  const initialResult = creature.activate(input);
  const initialError = Math.abs(initialResult[0] - target[0]);

  for (let i = 0; i < 50; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  const finalResult = creature.activate(input);
  const finalError = Math.abs(finalResult[0] - target[0]);
  assert(
    finalError < initialError,
    `Error should decrease: initial=${initialError}, final=${finalError}`,
  );
});

Deno.test("TopologicalBackpropagation - multiple outputs converge", () => {
  const json: CreatureExport = {
    input: 2,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.4 },
      { fromUUID: "h1", toUUID: "output-1", weight: 0.6 },
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
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.3, 0.7]);

  const initialResult = creature.activate(input);
  const initialError = Math.abs(initialResult[0] - target[0]) +
    Math.abs(initialResult[1] - target[1]);

  for (let i = 0; i < 50; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  const finalResult = creature.activate(input);
  const finalError = Math.abs(finalResult[0] - target[0]) +
    Math.abs(finalResult[1] - target[1]);
  assert(
    finalError < initialError,
    `Total error should decrease: initial=${initialError}, final=${finalError}`,
  );
});

Deno.test("TopologicalBackpropagation - weight updates applied", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
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
    trainingMutationRate: 1, // Always apply.
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.8]);

  const originalWeight = creature.synapses[0].weight;

  // Train and apply.
  for (let i = 0; i < 5; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  // Weight should have changed.
  assertNotEquals(
    creature.synapses[0].weight,
    originalWeight,
    "Weight should be updated after training",
  );
});

Deno.test("TopologicalBackpropagation - no error produces no change", () => {
  // If the network output matches the target, no changes should occur.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
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
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.5]);
  // Target matches what the network would produce (input * weight + bias = 0.5 * 1.0 + 0 = 0.5).
  const target = new Float32Array([0.5]);

  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, config, sparseConfig);

  // With the cached activation matching target, the node count should reflect
  // no-change propagation (ns.count remains at initial value).
  const ns = creature.state.node(creature.input);
  assertEquals(ns.noChange, true, "No change expected when output matches");
});

Deno.test("TopologicalBackpropagation - self-loop handled correctly", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "h1", weight: 0.1 }, // Self-loop
      { fromUUID: "h1", toUUID: "output-0", weight: 0.6 },
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
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.7]);
  const target = new Float32Array([0.3]);

  // Should not throw despite self-loop.
  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, config, sparseConfig);
});

Deno.test("TopologicalBackpropagation - deep network converges", () => {
  // 5-layer deep network to verify multi-level propagation.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h4", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.4 },
      { fromUUID: "h2", toUUID: "h3", weight: 0.6 },
      { fromUUID: "h3", toUUID: "h4", weight: 0.5 },
      { fromUUID: "h4", toUUID: "output-0", weight: 0.7 },
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
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.2]);

  const initialResult = creature.activate(input);
  const initialError = Math.abs(initialResult[0] - target[0]);

  for (let i = 0; i < 100; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  const finalResult = creature.activate(input);
  const finalError = Math.abs(finalResult[0] - target[0]);
  assert(
    finalError < initialError,
    `Error should decrease: initial=${initialError}, final=${finalError}`,
  );
});
