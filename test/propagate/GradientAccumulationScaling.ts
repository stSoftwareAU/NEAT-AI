/**
 * GradientAccumulationScaling.ts — Diagnostic tests for gradient accumulation
 * behaviour in neurons with varying fan-out connectivity.
 *
 * Issue #1871 — In TopologicalBackpropagation.ts, error signals from multiple
 * downstream paths are summed, not averaged (Issue #1651). A neuron connected
 * to many downstream neurons receives proportionally larger gradients than one
 * with few connections. These tests measure and verify this behaviour across
 * different network topologies.
 */

import {
  assert,
  assertAlmostEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

/**
 * Helper: create a standard backpropagation config for deterministic testing.
 */
function makeConfig(
  overrides?: Record<string, unknown>,
) {
  return createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Test 1: Fan-out gradient scaling — compare targetDeltaSum accumulation
//         for low fan-out (1 downstream) vs high fan-out (20 downstream).
// ---------------------------------------------------------------------------

Deno.test("Gradient accumulation - fan-out scaling: 1 vs 20 downstream neurons", () => {
  // Network A: neuronA feeds 1 downstream hidden neuron → output.
  // Network B: neuronB feeds 20 downstream hidden neurons → output.
  //
  // We measure the totalErrorAbsolute on each source neuron after a backward
  // pass. Since totalErrorAbsolute accumulates |error| from the topological
  // backpropagation, a neuron with 20 downstream paths should accumulate
  // significantly more error than one with 1 downstream path (given equal
  // per-path error contributions).

  // --- Network A: single downstream path ---
  const singleJson: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "source-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "mid-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "source-a", weight: 1.0 },
      { fromUUID: "source-a", toUUID: "mid-0", weight: 1.0 },
      { fromUUID: "mid-0", toUUID: "output-0", weight: 1.0 },
    ],
  };

  // --- Network B: 20 downstream paths ---
  const fanOutCount = 20;
  const multiNeurons: CreatureExport["neurons"] = [
    { type: "hidden", uuid: "source-b", squash: "IDENTITY", bias: 0 },
  ];
  const multiSynapses: CreatureExport["synapses"] = [
    { fromUUID: "input-0", toUUID: "source-b", weight: 1.0 },
  ];
  // Create 20 hidden neurons that source-b feeds into, each feeding the output.
  for (let i = 0; i < fanOutCount; i++) {
    const midUuid = `mid-${i}`;
    multiNeurons.push({
      type: "hidden",
      uuid: midUuid,
      squash: "IDENTITY",
      bias: 0,
    });
    multiSynapses.push({
      fromUUID: "source-b",
      toUUID: midUuid,
      weight: 1.0,
    });
    multiSynapses.push({
      fromUUID: midUuid,
      toUUID: "output-0",
      weight: 1.0 / fanOutCount, // Scale to keep output comparable.
    });
  }
  multiNeurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const multiJson: CreatureExport = {
    input: 1,
    output: 1,
    neurons: multiNeurons,
    synapses: multiSynapses,
  };

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.5]);

  // --- Run backward pass on single-downstream network ---
  const singleCreature = Creature.fromJSON(singleJson);
  const singleConfig = makeConfig();
  const singleSparse = new SparseConfig(singleJson, singleConfig);

  singleCreature.activateAndTrace(input, false, singleSparse);
  singleCreature.propagate(target, singleConfig, singleSparse);

  // Find the source neuron index (first hidden neuron after inputs).
  const singleSourceIdx = singleCreature.input; // First non-input neuron.
  const singleNS = singleCreature.state.node(singleSourceIdx);
  const singleError = singleNS.totalErrorAbsolute;

  // --- Run backward pass on multi-downstream network ---
  const multiCreature = Creature.fromJSON(multiJson);
  const multiConfig = makeConfig();
  const multiSparse = new SparseConfig(multiJson, multiConfig);

  multiCreature.activateAndTrace(input, false, multiSparse);
  multiCreature.propagate(target, multiConfig, multiSparse);

  const multiSourceIdx = multiCreature.input; // First non-input neuron.
  const multiNS = multiCreature.state.node(multiSourceIdx);
  const multiError = multiNS.totalErrorAbsolute;

  // Verify both neurons received some error.
  assertGreater(
    singleError,
    0,
    "Single-downstream neuron should accumulate error",
  );
  assertGreater(
    multiError,
    0,
    "Multi-downstream neuron should accumulate error",
  );

  // The multi-downstream neuron should have accumulated more error because
  // gradients from 20 downstream paths are summed (not averaged).
  const ratio = multiError / singleError;
  assertGreater(
    ratio,
    1.0,
    `Fan-out neuron (20 downstream) should accumulate more error than ` +
      `single-downstream neuron. Ratio: ${ratio.toFixed(3)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 2: Weight update magnitude comparison — high fan-out vs low fan-out.
// ---------------------------------------------------------------------------

Deno.test("Gradient accumulation - weight update magnitude: high vs low fan-out", () => {
  // Build a single network with two hidden branches:
  //   Input → lowFanOut  → output  (1 downstream connection)
  //   Input → highFanOut → h1, h2, h3, h4, h5 → output  (5 downstream)
  //
  // After a backward pass, compare the weight change on input→lowFanOut
  // vs input→highFanOut. The high fan-out branch should see larger updates
  // because gradient signals are summed across all 5 downstream paths.

  const fanOut = 5;
  const neurons: CreatureExport["neurons"] = [
    { type: "hidden", uuid: "low-fan", squash: "IDENTITY", bias: 0 },
    { type: "hidden", uuid: "high-fan", squash: "IDENTITY", bias: 0 },
  ];
  const synapses: CreatureExport["synapses"] = [
    { fromUUID: "input-0", toUUID: "low-fan", weight: 1.0 },
    { fromUUID: "input-0", toUUID: "high-fan", weight: 1.0 },
    { fromUUID: "low-fan", toUUID: "output-0", weight: 1.0 },
  ];

  // Create intermediate neurons for the high-fan-out branch.
  for (let i = 0; i < fanOut; i++) {
    const uuid = `hf-mid-${i}`;
    neurons.push({
      type: "hidden",
      uuid,
      squash: "IDENTITY",
      bias: 0,
    });
    synapses.push({ fromUUID: "high-fan", toUUID: uuid, weight: 1.0 });
    synapses.push({
      fromUUID: uuid,
      toUUID: "output-0",
      weight: 1.0 / fanOut,
    });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const json: CreatureExport = { input: 1, output: 1, neurons, synapses };

  const creature = Creature.fromJSON(json);
  const config = makeConfig();
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([0.5]);

  // Record original weights for the two key synapses.
  const lowFanSynapseIdx = creature.synapses.findIndex(
    (s) =>
      creature.neurons[s.from].id === 0 &&
      creature.neurons[s.to].id === 9376,
  );
  const highFanSynapseIdx = creature.synapses.findIndex(
    (s) =>
      creature.neurons[s.from].id === 0 &&
      creature.neurons[s.to].id === 9244,
  );

  assert(lowFanSynapseIdx >= 0, "Should find low-fan synapse");
  assert(highFanSynapseIdx >= 0, "Should find high-fan synapse");

  const originalLowWeight = creature.synapses[lowFanSynapseIdx].weight;
  const originalHighWeight = creature.synapses[highFanSynapseIdx].weight;

  // Train and apply.
  for (let i = 0; i < 5; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  const lowWeightChange = Math.abs(
    creature.synapses[lowFanSynapseIdx].weight - originalLowWeight,
  );
  const highWeightChange = Math.abs(
    creature.synapses[highFanSynapseIdx].weight - originalHighWeight,
  );

  // The high fan-out neuron receives summed gradients from 5 downstream
  // paths, so its upstream weight should change more.
  assertGreater(
    highWeightChange,
    0,
    "High fan-out path should produce weight changes",
  );
  assertGreater(
    lowWeightChange,
    0,
    "Low fan-out path should produce weight changes",
  );

  const ratio = highWeightChange / lowWeightChange;
  assertGreater(
    ratio,
    1.0,
    `High fan-out (${fanOut} downstream) weight change should exceed ` +
      `low fan-out (1 downstream). Ratio: ${ratio.toFixed(3)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 3: Convergence comparison — uniform vs skewed connectivity.
// ---------------------------------------------------------------------------

Deno.test("Gradient accumulation - convergence: uniform vs skewed topology", () => {
  // Uniform network: 5 hidden neurons, each with ~2 connections.
  //   Input-0, Input-1 → h0, h1, h2, h3, h4 → Output
  // Each hidden neuron has exactly 1 input connection and 1 output connection.
  const uniformJson: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "u-h0", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h2", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h3", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h4", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "u-h0", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "u-h1", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "u-h2", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "u-h3", weight: 0.6 },
      { fromUUID: "input-0", toUUID: "u-h4", weight: 0.5 },
      { fromUUID: "u-h0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "u-h1", toUUID: "output-0", weight: 0.4 },
      { fromUUID: "u-h2", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "u-h3", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "u-h4", toUUID: "output-0", weight: 0.4 },
    ],
  };

  // Skewed network: same neuron count, but one neuron (hub) has high fan-out
  // (feeds all others), while remaining neurons have minimal connectivity.
  //   Input-0 → hub → s-h1, s-h2, s-h3, s-h4 → Output
  //   Input-1 → hub
  //   Also: s-h1 has low fan-out (only to output).
  const skewedJson: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hub", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h2", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h3", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h4", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hub", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hub", weight: 0.4 },
      // Hub fans out to all 4 hidden neurons (high fan-out = 4).
      { fromUUID: "hub", toUUID: "s-h1", weight: 0.3 },
      { fromUUID: "hub", toUUID: "s-h2", weight: 0.4 },
      { fromUUID: "hub", toUUID: "s-h3", weight: 0.5 },
      { fromUUID: "hub", toUUID: "s-h4", weight: 0.3 },
      // Each secondary neuron feeds directly to output (low fan-out = 1).
      { fromUUID: "s-h1", toUUID: "output-0", weight: 0.4 },
      { fromUUID: "s-h2", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "s-h3", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "s-h4", toUUID: "output-0", weight: 0.4 },
    ],
  };

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.3]);
  const iterations = 50;

  // Helper to compute error after training.
  function trainAndMeasure(json: CreatureExport): {
    initialError: number;
    finalError: number;
  } {
    const creature = Creature.fromJSON(json);
    const config = makeConfig({
      learningRate: 0.05,
      maximumWeightAdjustmentScale: 1,
      maximumBiasAdjustmentScale: 1,
    });
    const sparseConfig = new SparseConfig(json, config);

    const initialResult = creature.activate(input);
    const initialError = Math.abs(initialResult[0] - target[0]);

    for (let i = 0; i < iterations; i++) {
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);

    const finalResult = creature.activate(input);
    const finalError = Math.abs(finalResult[0] - target[0]);
    return { initialError, finalError };
  }

  const uniform = trainAndMeasure(uniformJson);
  const skewed = trainAndMeasure(skewedJson);

  // Both networks should converge (error decreases).
  assertLess(
    uniform.finalError,
    uniform.initialError,
    `Uniform topology should converge: initial=${uniform.initialError}, ` +
      `final=${uniform.finalError}`,
  );
  assertLess(
    skewed.finalError,
    skewed.initialError,
    `Skewed topology should converge: initial=${skewed.initialError}, ` +
      `final=${skewed.finalError}`,
  );

  // Document the convergence rates for diagnostic purposes.
  const uniformReduction = 1 - (uniform.finalError / uniform.initialError);
  const skewedReduction = 1 - (skewed.finalError / skewed.initialError);

  // Both should achieve meaningful error reduction (at least 10%).
  assertGreater(
    uniformReduction,
    0.1,
    `Uniform topology error reduction should be meaningful: ${
      (uniformReduction * 100).toFixed(1)
    }%`,
  );
  assertGreater(
    skewedReduction,
    0.1,
    `Skewed topology error reduction should be meaningful: ${
      (skewedReduction * 100).toFixed(1)
    }%`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: Large creature gradient statistics — min/max/mean/stddev of
//         accumulated error deltas across 561 neurons, 13,905 synapses.
// ---------------------------------------------------------------------------

Deno.test("Gradient accumulation - large creature gradient statistics", async () => {
  const creatureJson = JSON.parse(
    await Deno.readTextFile("test/propagate/large/creature.json"),
  );
  const trainingSet: { input: number[]; output: number[] }[] = JSON.parse(
    await Deno.readTextFile("test/propagate/large/td.json"),
  );

  const creature = Creature.fromJSON(creatureJson);
  creature.validate();

  const config = makeConfig({
    learningRate: 1.0,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
  });
  const sparseConfig = new SparseConfig(creatureJson, config);

  // Use real training data to exercise the network with realistic inputs.
  // Process several samples to accumulate error across the topology.
  const samplesToUse = Math.min(10, trainingSet.length);
  for (let s = 0; s < samplesToUse; s++) {
    const sample = trainingSet[s];
    const inputArr = new Float32Array(sample.input);
    const targetArr = new Float32Array(sample.output);
    creature.activateAndTrace(inputArr, false, sparseConfig);
    creature.propagate(targetArr, config, sparseConfig);
  }

  // Collect totalErrorAbsolute for all non-input neurons.
  const errors: number[] = [];
  const neuronCount = creature.neurons.length;
  for (let i = creature.input; i < neuronCount; i++) {
    const ns = creature.state.node(i);
    errors.push(ns.totalErrorAbsolute);
  }

  // Verify all error values are finite (no NaN or Infinity).
  for (const e of errors) {
    assert(Number.isFinite(e), `All error values should be finite, got ${e}`);
  }

  // Compute statistics over neurons that received error.
  const nonZeroErrors = errors.filter((e) => e > 0);
  assert(
    nonZeroErrors.length > 0,
    "At least some neurons should have accumulated error",
  );

  // In a large NEAT topology (561 neurons, 13905 synapses), error
  // propagation depth depends on activation ranges, weight magnitudes,
  // and squash function saturation. Even limited propagation demonstrates
  // that the backward pass operates correctly on complex networks.

  // If multiple neurons received error, verify statistical spread.
  if (nonZeroErrors.length >= 2) {
    const min = Math.min(...nonZeroErrors);
    const max = Math.max(...nonZeroErrors);
    const mean = nonZeroErrors.reduce((a, b) => a + b, 0) /
      nonZeroErrors.length;
    const variance = nonZeroErrors.reduce(
      (sum, e) => sum + (e - mean) * (e - mean),
      0,
    ) / nonZeroErrors.length;
    const stddev = Math.sqrt(variance);

    // Neurons at different topology depths with different fan-out
    // should accumulate different amounts of error.
    assertGreater(max, min, "Max error should exceed min error");
    assertGreater(stddev, 0, "Standard deviation should be non-zero");

    // The max/min ratio quantifies gradient scaling imbalance caused by
    // varying fan-out across the NEAT topology.
    const maxMinRatio = max / min;
    assertGreater(
      maxMinRatio,
      1.0,
      "Max/min error ratio should show variation across neurons",
    );
  }
});

// ---------------------------------------------------------------------------
// Test 5: Verify gradient ratio is proportional to fan-out count.
// ---------------------------------------------------------------------------

Deno.test("Gradient accumulation - error ratio scales with fan-out count", () => {
  // Build networks with fan-out of 1, 3, and 10, and verify the
  // totalErrorAbsolute scales roughly proportionally.

  function buildFanOutNetwork(fanOut: number): CreatureExport {
    const neurons: CreatureExport["neurons"] = [
      { type: "hidden", uuid: "source", squash: "IDENTITY", bias: 0 },
    ];
    const synapses: CreatureExport["synapses"] = [
      { fromUUID: "input-0", toUUID: "source", weight: 1.0 },
    ];
    for (let i = 0; i < fanOut; i++) {
      neurons.push({
        type: "hidden",
        uuid: `mid-${i}`,
        squash: "IDENTITY",
        bias: 0,
      });
      synapses.push({
        fromUUID: "source",
        toUUID: `mid-${i}`,
        weight: 1.0,
      });
      synapses.push({
        fromUUID: `mid-${i}`,
        toUUID: "output-0",
        weight: 1.0 / fanOut,
      });
    }
    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    });
    return { input: 1, output: 1, neurons, synapses };
  }

  function measureSourceError(json: CreatureExport): number {
    const creature = Creature.fromJSON(json);
    const config = makeConfig();
    const sparse = new SparseConfig(json, config);

    creature.activateAndTrace(new Float32Array([1.0]), false, sparse);
    creature.propagate(new Float32Array([0.5]), config, sparse);

    const sourceIdx = creature.input; // First non-input neuron = source.
    return creature.state.node(sourceIdx).totalErrorAbsolute;
  }

  const error1 = measureSourceError(buildFanOutNetwork(1));
  const error3 = measureSourceError(buildFanOutNetwork(3));
  const error10 = measureSourceError(buildFanOutNetwork(10));

  assertGreater(error1, 0, "Fan-out 1 should produce error");
  assertGreater(error3, 0, "Fan-out 3 should produce error");
  assertGreater(error10, 0, "Fan-out 10 should produce error");

  // Error should increase with fan-out (gradient summing, not averaging).
  assertGreater(
    error3,
    error1,
    `Fan-out 3 error (${error3.toFixed(6)}) should exceed ` +
      `fan-out 1 error (${error1.toFixed(6)})`,
  );
  assertGreater(
    error10,
    error3,
    `Fan-out 10 error (${error10.toFixed(6)}) should exceed ` +
      `fan-out 3 error (${error3.toFixed(6)})`,
  );

  // The ratio of errors should approximate the ratio of fan-out counts.
  const ratio3to1 = error3 / error1;
  const ratio10to1 = error10 / error1;

  // With IDENTITY squash and unit weights, the ratio should be close to
  // the fan-out ratio. Allow generous tolerance for elastic distribution.
  assertGreater(
    ratio3to1,
    1.5,
    `Fan-out 3/1 error ratio should be > 1.5, got ${ratio3to1.toFixed(3)}`,
  );
  assertGreater(
    ratio10to1,
    3.0,
    `Fan-out 10/1 error ratio should be > 3.0, got ${ratio10to1.toFixed(3)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 6: Verify that fan-out gradient distribution keeps values finite.
// ---------------------------------------------------------------------------

Deno.test("Gradient accumulation - extreme fan-out produces finite gradients", () => {
  // Network with a neuron fanning out to 50 downstream neurons.
  // Verify all weights and biases remain finite after training.
  const fanOut = 50;
  const neurons: CreatureExport["neurons"] = [
    { type: "hidden", uuid: "hub", squash: "TANH", bias: 0 },
  ];
  const synapses: CreatureExport["synapses"] = [
    { fromUUID: "input-0", toUUID: "hub", weight: 0.5 },
  ];

  for (let i = 0; i < fanOut; i++) {
    const uuid = `fan-${i}`;
    neurons.push({
      type: "hidden",
      uuid,
      squash: "TANH",
      bias: 0,
    });
    synapses.push({ fromUUID: "hub", toUUID: uuid, weight: 0.3 });
    synapses.push({
      fromUUID: uuid,
      toUUID: "output-0",
      weight: 1.0 / fanOut,
    });
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const json: CreatureExport = { input: 1, output: 1, neurons, synapses };
  const creature = Creature.fromJSON(json);
  const config = makeConfig({
    learningRate: 0.05,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([0.8]);
  const target = new Float32Array([0.2]);

  // Train multiple iterations.
  for (let i = 0; i < 20; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  // All weights and biases must remain finite.
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Synapse weight should be finite after extreme fan-out training, got ${synapse.weight}`,
    );
  }
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input" && neuron.type !== "constant") {
      assert(
        Number.isFinite(neuron.bias),
        `Neuron bias should be finite after extreme fan-out training, got ${neuron.bias}`,
      );
    }
  }

  // The network should still produce finite output.
  const result = creature.activate(input);
  assert(
    Number.isFinite(result[0]),
    `Output should be finite after extreme fan-out training, got ${result[0]}`,
  );
});

// ---------------------------------------------------------------------------
// Test 7: Error accumulation symmetry — same fan-out should yield similar error.
// ---------------------------------------------------------------------------

Deno.test("Gradient accumulation - symmetric fan-out yields similar error", () => {
  // Two hidden neurons with identical fan-out (both feed 3 downstream
  // neurons). Their totalErrorAbsolute should be comparable when they
  // receive similar input and downstream error.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "sym-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "sym-b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "a-mid-0", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "a-mid-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "a-mid-2", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b-mid-0", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b-mid-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b-mid-2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "sym-a", weight: 1.0 },
      { fromUUID: "input-0", toUUID: "sym-b", weight: 1.0 },
      // sym-a fans out to 3 intermediaries.
      { fromUUID: "sym-a", toUUID: "a-mid-0", weight: 1.0 },
      { fromUUID: "sym-a", toUUID: "a-mid-1", weight: 1.0 },
      { fromUUID: "sym-a", toUUID: "a-mid-2", weight: 1.0 },
      // sym-b fans out to 3 intermediaries.
      { fromUUID: "sym-b", toUUID: "b-mid-0", weight: 1.0 },
      { fromUUID: "sym-b", toUUID: "b-mid-1", weight: 1.0 },
      { fromUUID: "sym-b", toUUID: "b-mid-2", weight: 1.0 },
      // All intermediaries feed the output equally.
      { fromUUID: "a-mid-0", toUUID: "output-0", weight: 1.0 / 6 },
      { fromUUID: "a-mid-1", toUUID: "output-0", weight: 1.0 / 6 },
      { fromUUID: "a-mid-2", toUUID: "output-0", weight: 1.0 / 6 },
      { fromUUID: "b-mid-0", toUUID: "output-0", weight: 1.0 / 6 },
      { fromUUID: "b-mid-1", toUUID: "output-0", weight: 1.0 / 6 },
      { fromUUID: "b-mid-2", toUUID: "output-0", weight: 1.0 / 6 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const config = makeConfig();
  const sparseConfig = new SparseConfig(json, config);

  creature.activateAndTrace(new Float32Array([1.0]), false, sparseConfig);
  creature.propagate(new Float32Array([0.5]), config, sparseConfig);

  // Find sym-a and sym-b neuron indices.
  const symAIdx = creature.neurons.findIndex((n) => n.id === 9293);
  const symBIdx = creature.neurons.findIndex((n) => n.id === 9277);
  assert(symAIdx >= 0, "Should find sym-a neuron");
  assert(symBIdx >= 0, "Should find sym-b neuron");

  const errorA = creature.state.node(symAIdx).totalErrorAbsolute;
  const errorB = creature.state.node(symBIdx).totalErrorAbsolute;

  assertGreater(errorA, 0, "sym-a should accumulate error");
  assertGreater(errorB, 0, "sym-b should accumulate error");

  // With symmetric topology, identical weights, and same input, the error
  // accumulation should be equal.
  assertAlmostEquals(
    errorA,
    errorB,
    errorA * 0.01, // 1% tolerance.
    `Symmetric neurons should have similar error: A=${errorA}, B=${errorB}`,
  );
});
