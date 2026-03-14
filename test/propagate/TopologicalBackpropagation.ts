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

  // Verify the network state remains finite after propagation with a self-loop
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Synapse weight should remain finite after self-loop propagation, got ${synapse.weight}`,
    );
  }
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      assert(
        Number.isFinite(neuron.bias),
        `Neuron bias should remain finite after self-loop propagation, got ${neuron.bias}`,
      );
    }
  }
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

Deno.test("TopologicalBackpropagation - fan-out gradient scales with downstream count", () => {
  // Issue #1651 - A neuron feeding N downstream paths should receive N× the
  // error signal of one feeding 1 path (given equal per-path error).
  //
  // Network with 1 downstream output:
  //   Input → H1 → Output-0
  //
  // Network with 3 downstream outputs:
  //   Input → H1 → Output-0
  //              → Output-1
  //              → Output-2
  //
  // Both use identical weights, inputs, and per-output target deltas.
  // The 3-output network should accumulate ~3× the weight change on the
  // input→H1 synapse compared to the 1-output network.

  const singleOutputJson: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
    ],
  };

  const tripleOutputJson: CreatureExport = {
    input: 1,
    output: 3,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-2", weight: 1.0 },
    ],
  };

  const configOpts = {
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1,
  };

  const input = new Float32Array([1.0]);
  // Each output requests the same delta (target = 1.1 when activation is 1.0).
  const singleTarget = new Float32Array([1.1]);
  const tripleTarget = new Float32Array([1.1, 1.1, 1.1]);

  // Train the single-output network.
  const singleCreature = Creature.fromJSON(singleOutputJson);
  const singleConfig = createBackPropagationConfig(configOpts);
  const singleSparse = new SparseConfig(singleOutputJson, singleConfig);

  singleCreature.activateAndTrace(input, false, singleSparse);
  singleCreature.propagate(singleTarget, singleConfig, singleSparse);
  singleCreature.applyLearnings(singleConfig, singleSparse);

  const singleWeightChange = Math.abs(
    singleCreature.synapses[0].weight - 1.0,
  );

  // Train the triple-output network.
  const tripleCreature = Creature.fromJSON(tripleOutputJson);
  const tripleConfig = createBackPropagationConfig(configOpts);
  const tripleSparse = new SparseConfig(tripleOutputJson, tripleConfig);

  tripleCreature.activateAndTrace(input, false, tripleSparse);
  tripleCreature.propagate(tripleTarget, tripleConfig, tripleSparse);
  tripleCreature.applyLearnings(tripleConfig, tripleSparse);

  const tripleWeightChange = Math.abs(
    tripleCreature.synapses[0].weight - 1.0,
  );

  // The triple-output network should have ~3× the weight change,
  // since 3 downstream paths each contribute the same error signal.
  // With averaging, the ratio would be ~1. With correct summing, ~3.
  assert(
    singleWeightChange > 0,
    `Single output should produce a weight change, got ${singleWeightChange}`,
  );
  const ratio = tripleWeightChange / singleWeightChange;
  assert(
    ratio > 2.0,
    `Fan-out gradient ratio should be ~3 (sum), got ${ratio} (averaging would give ~1)`,
  );
});

Deno.test("TopologicalBackpropagation - fan-out convergence improved", () => {
  // Issue #1651 - A fan-out network should converge well when gradients
  // are properly summed. This verifies that wider networks (more downstream
  // connections) benefit from correct gradient accumulation.
  const json: CreatureExport = {
    input: 2,
    output: 4,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-3", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.4 },
      { fromUUID: "h1", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "output-2", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-3", weight: 0.6 },
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
  const target = new Float32Array([0.2, 0.3, 0.1, 0.4]);

  const initialResult = creature.activate(input);
  let initialError = 0;
  for (let i = 0; i < target.length; i++) {
    initialError += Math.abs(initialResult[i] - target[i]);
  }

  for (let i = 0; i < 50; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  const finalResult = creature.activate(input);
  let finalError = 0;
  for (let i = 0; i < target.length; i++) {
    finalError += Math.abs(finalResult[i] - target[i]);
  }
  assert(
    finalError < initialError,
    `Fan-out network error should decrease: initial=${initialError}, final=${finalError}`,
  );
});
