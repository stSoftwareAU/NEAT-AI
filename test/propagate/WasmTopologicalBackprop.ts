/**
 * Tests for WASM topological backpropagation (Issue #1954).
 *
 * Verifies that the WASM-accelerated backpropagation path produces
 * correct results by comparing convergence behaviour against known-good
 * test cases.
 *
 * Tests use batchSize > 1 to exercise the WASM path (batchSize === 1
 * falls back to TS due to mid-loop weight/bias recalculation).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

Deno.test("WasmTopologicalBackprop - single neuron convergence via WASM", () => {
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
    batchSize: 64,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.8]);

  for (let i = 0; i < 100; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  const result = creature.activate(input);
  const error = Math.abs(result[0] - target[0]);
  assert(error < 0.3, `Error should decrease after training, got ${error}`);
});

Deno.test("WasmTopologicalBackprop - multi-layer TANH convergence", () => {
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
    batchSize: 64,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.4]);

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

Deno.test("WasmTopologicalBackprop - mixed squash types converge", () => {
  // Test with multiple squash types to exercise the WASM path thoroughly.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "ReLU", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "GELU", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h2", weight: 0.3 },
      { fromUUID: "h1", toUUID: "h3", weight: 0.4 },
      { fromUUID: "h2", toUUID: "h3", weight: 0.6 },
      { fromUUID: "h3", toUUID: "output-0", weight: 0.7 },
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
    batchSize: 64,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.3]);

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

Deno.test("WasmTopologicalBackprop - weight accumulation state updated", () => {
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
    batchSize: 64,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.8]);

  for (let i = 0; i < 5; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }

  // Check that synapse state has been accumulated.
  const cs = creature.state.connection(0, creature.input);
  assert(
    cs.count > 0,
    `Synapse state count should be > 0 after training, got ${cs.count}`,
  );
});

Deno.test("WasmTopologicalBackprop - neuron state updated correctly", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
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
    batchSize: 64,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.7]);
  const target = new Float32Array([0.3]);

  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, config, sparseConfig);

  // Output neuron should have error tracked.
  const outputIdx = creature.neurons.length - 1;
  const ns = creature.state.node(outputIdx);
  assert(
    ns.totalErrorAbsolute > 0,
    `Output neuron should have error > 0, got ${ns.totalErrorAbsolute}`,
  );
});

Deno.test("WasmTopologicalBackprop - no error produces no change", () => {
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
    batchSize: 64,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.5]);
  const target = new Float32Array([0.5]);

  creature.activateAndTrace(input, false, sparseConfig);
  creature.propagate(target, config, sparseConfig);

  const ns = creature.state.node(creature.input);
  assertEquals(ns.noChange, true, "No change expected when output matches");
});
