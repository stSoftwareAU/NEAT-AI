/**
 * Gradient Accumulation Scaling Tests
 *
 * Issue #1871 - Diagnostic tests that measure and verify gradient accumulation
 * behaviour for neurons with varying connectivity in NEAT topologies.
 *
 * In TopologicalBackpropagation.ts, error signals from multiple downstream
 * paths are summed, not averaged (line 92, Issue #1651). A neuron connected
 * to many downstream neurons receives proportionally more gradient than one
 * with few connections. These tests quantify that behaviour.
 *
 * Part of #1869
 */

import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

// ---------------------------------------------------------------------------
// Test 1: Fan-out gradient scaling
// ---------------------------------------------------------------------------
Deno.test("GradientAccumulationScaling - fan-out gradient scaling", () => {
  // Neuron A feeds into 1 downstream neuron.
  // Neuron B feeds into 20 downstream neurons.
  // Both receive the same initial error at each downstream neuron.
  // We measure weight update magnitude on the input→neuron synapse.

  const outputCount = 20;

  // Build single-output network: Input → H → Output
  const singleJson: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hA", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hA", weight: 1.0 },
      { fromUUID: "hA", toUUID: "output-0", weight: 1.0 },
    ],
  };

  // Build multi-output network: Input → H → Output-0..Output-19
  const multiNeurons: CreatureExport["neurons"] = [
    { type: "hidden", uuid: "hB", squash: "IDENTITY", bias: 0 },
  ];
  const multiSynapses: CreatureExport["synapses"] = [
    { fromUUID: "input-0", toUUID: "hB", weight: 1.0 },
  ];
  for (let i = 0; i < outputCount; i++) {
    multiNeurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
    multiSynapses.push({
      fromUUID: "hB",
      toUUID: `output-${i}`,
      weight: 1.0,
    });
  }
  const multiJson: CreatureExport = {
    input: 1,
    output: outputCount,
    neurons: multiNeurons,
    synapses: multiSynapses,
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
  const singleTarget = new Float32Array([1.1]);
  const multiTarget = new Float32Array(outputCount).fill(1.1);

  // Train single-output network.
  const singleCreature = Creature.fromJSON(singleJson);
  const singleConfig = createBackPropagationConfig(configOpts);
  const singleSparse = new SparseConfig(singleJson, singleConfig);

  singleCreature.activateAndTrace(input, false, singleSparse);
  singleCreature.propagate(singleTarget, singleConfig, singleSparse);
  singleCreature.applyLearnings(singleConfig, singleSparse);

  const singleWeightChange = Math.abs(singleCreature.synapses[0].weight - 1.0);

  // Train multi-output network.
  const multiCreature = Creature.fromJSON(multiJson);
  const multiConfig = createBackPropagationConfig(configOpts);
  const multiSparse = new SparseConfig(multiJson, multiConfig);

  multiCreature.activateAndTrace(input, false, multiSparse);
  multiCreature.propagate(multiTarget, multiConfig, multiSparse);
  multiCreature.applyLearnings(multiConfig, multiSparse);

  const multiWeightChange = Math.abs(multiCreature.synapses[0].weight - 1.0);

  // Verify that both networks produced weight changes.
  assert(
    singleWeightChange > 0,
    `Single-output network should produce a weight change, got ${singleWeightChange}`,
  );
  assert(
    multiWeightChange > 0,
    `Multi-output network should produce a weight change, got ${multiWeightChange}`,
  );

  // The multi-output network's hidden neuron receives gradients from 20
  // downstream paths vs 1. With summing (not averaging), the ratio should
  // be significantly greater than 1.
  const ratio = multiWeightChange / singleWeightChange;
  assert(
    ratio > 2.0,
    `Fan-out gradient ratio should be >> 1 (summing behaviour), got ${ratio}`,
  );

  // Document the measured ratio for diagnostic purposes.
  console.log(
    `Fan-out gradient scaling: 1-output weight change = ${
      singleWeightChange.toFixed(6)
    }, ` +
      `${outputCount}-output weight change = ${
        multiWeightChange.toFixed(6)
      }, ` +
      `ratio = ${ratio.toFixed(2)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 2: Weight update magnitude comparison
// ---------------------------------------------------------------------------
Deno.test("GradientAccumulationScaling - weight update magnitude comparison", () => {
  // Build a network with mixed connectivity:
  //   Input-0 → H-low  → Output-0              (low fan-out: 1)
  //   Input-1 → H-high → Output-0..Output-9    (high fan-out: 10)
  const highFanOut = 10;

  const neurons: CreatureExport["neurons"] = [
    { type: "hidden", uuid: "h-low", squash: "IDENTITY", bias: 0 },
    { type: "hidden", uuid: "h-high", squash: "IDENTITY", bias: 0 },
  ];
  const synapses: CreatureExport["synapses"] = [
    { fromUUID: "input-0", toUUID: "h-low", weight: 0.5 },
    { fromUUID: "input-1", toUUID: "h-high", weight: 0.5 },
    { fromUUID: "h-low", toUUID: "output-0", weight: 0.5 },
  ];

  for (let i = 0; i < highFanOut; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
    synapses.push({
      fromUUID: "h-high",
      toUUID: `output-${i}`,
      weight: 0.5,
    });
  }

  const json: CreatureExport = {
    input: 2,
    output: highFanOut,
    neurons,
    synapses,
  };

  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1,
    trainingMutationRate: 1,
  });
  const sparseConfig = new SparseConfig(json, config);

  const input = new Float32Array([1.0, 1.0]);
  const target = new Float32Array(highFanOut).fill(0.6);

  const creature = Creature.fromJSON(json);
  const originalWeights = creature.synapses.map((s) => s.weight);

  // Train several iterations.
  for (let i = 0; i < 5; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);

  // Find weight changes for input→h-low and input→h-high synapses.
  // Synapse indices: input-0 is index 0, input-1 is index 1,
  // h-low is at creature.input (first hidden), h-high is creature.input+1.
  const hLowIdx = creature.input; // first hidden neuron index
  const hHighIdx = creature.input + 1; // second hidden neuron index

  let lowFanOutChange: { change: number } | undefined;
  let highFanOutChange: { change: number } | undefined;

  for (let idx = 0; idx < creature.synapses.length; idx++) {
    const s = creature.synapses[idx];
    const change = Math.abs(s.weight - originalWeights[idx]);
    if (s.from === 0 && s.to === hLowIdx) {
      lowFanOutChange = { change };
    } else if (s.from === 1 && s.to === hHighIdx) {
      highFanOutChange = { change };
    }
  }

  assert(
    lowFanOutChange !== undefined,
    "Should find input-0 → h-low synapse",
  );
  assert(
    highFanOutChange !== undefined,
    "Should find input-1 → h-high synapse",
  );

  // Both should show some change.
  assert(
    lowFanOutChange!.change > 0 || highFanOutChange!.change > 0,
    "At least one path should show a weight change",
  );

  // High fan-out neuron receives more accumulated gradient.
  if (lowFanOutChange!.change > 0) {
    const updateRatio = highFanOutChange!.change / lowFanOutChange!.change;
    console.log(
      `Weight update ratio (high/low fan-out): ${updateRatio.toFixed(2)} ` +
        `(low=${lowFanOutChange!.change.toFixed(6)}, high=${
          highFanOutChange!.change.toFixed(6)
        })`,
    );
    // The high fan-out neuron should receive proportionally larger updates.
    assert(
      updateRatio > 1.0,
      `High fan-out neuron should receive larger weight updates, ratio = ${
        updateRatio.toFixed(2)
      }`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test 3: Convergence comparison — uniform vs skewed connectivity
// ---------------------------------------------------------------------------
Deno.test("GradientAccumulationScaling - convergence uniform vs skewed topology", () => {
  // Uniform topology: 5 hidden neurons, each connected to ~3 outputs.
  const uniformJson: CreatureExport = {
    input: 2,
    output: 3,
    neurons: [
      { type: "hidden", uuid: "u-h0", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h2", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h3", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "u-h4", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // Inputs to hidden (uniform)
      { fromUUID: "input-0", toUUID: "u-h0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "u-h1", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "u-h2", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "u-h3", weight: 0.4 },
      { fromUUID: "input-0", toUUID: "u-h4", weight: 0.3 },
      // Hidden to outputs (each hidden feeds ~1-2 outputs — relatively uniform)
      { fromUUID: "u-h0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "u-h1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "u-h2", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "u-h3", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "u-h4", toUUID: "output-2", weight: 0.5 },
      { fromUUID: "u-h0", toUUID: "output-2", weight: 0.3 },
    ],
  };

  // Skewed topology: one neuron fans out to all outputs, others have 1.
  const skewedJson: CreatureExport = {
    input: 2,
    output: 3,
    neurons: [
      { type: "hidden", uuid: "s-h0", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h2", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h3", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "s-h4", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // Inputs to hidden
      { fromUUID: "input-0", toUUID: "s-h0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "s-h1", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "s-h2", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "s-h3", weight: 0.4 },
      { fromUUID: "input-0", toUUID: "s-h4", weight: 0.3 },
      // s-h0 fans out to ALL 3 outputs (skewed — high fan-out)
      { fromUUID: "s-h0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "s-h0", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "s-h0", toUUID: "output-2", weight: 0.5 },
      // Other neurons: minimal fan-out (1 each)
      { fromUUID: "s-h1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "s-h2", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "s-h3", toUUID: "output-2", weight: 0.3 },
    ],
  };

  const configOpts = {
    generations: 1,
    learningRate: 0.05,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
  };

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array([0.2, 0.3, 0.1]);
  const iterations = 50;

  // Train uniform topology.
  const uniformCreature = Creature.fromJSON(uniformJson);
  const uniformConfig = createBackPropagationConfig(configOpts);
  const uniformSparse = new SparseConfig(uniformJson, uniformConfig);

  const uniformInitial = uniformCreature.activate(input);
  let uniformInitialError = 0;
  for (let i = 0; i < target.length; i++) {
    uniformInitialError += Math.abs(uniformInitial[i] - target[i]);
  }

  for (let i = 0; i < iterations; i++) {
    uniformCreature.activateAndTrace(input, false, uniformSparse);
    uniformCreature.propagate(target, uniformConfig, uniformSparse);
  }
  uniformCreature.applyLearnings(uniformConfig, uniformSparse);

  const uniformFinal = uniformCreature.activate(input);
  let uniformFinalError = 0;
  for (let i = 0; i < target.length; i++) {
    uniformFinalError += Math.abs(uniformFinal[i] - target[i]);
  }

  // Train skewed topology.
  const skewedCreature = Creature.fromJSON(skewedJson);
  const skewedConfig = createBackPropagationConfig(configOpts);
  const skewedSparse = new SparseConfig(skewedJson, skewedConfig);

  const skewedInitial = skewedCreature.activate(input);
  let skewedInitialError = 0;
  for (let i = 0; i < target.length; i++) {
    skewedInitialError += Math.abs(skewedInitial[i] - target[i]);
  }

  for (let i = 0; i < iterations; i++) {
    skewedCreature.activateAndTrace(input, false, skewedSparse);
    skewedCreature.propagate(target, skewedConfig, skewedSparse);
  }
  skewedCreature.applyLearnings(skewedConfig, skewedSparse);

  const skewedFinal = skewedCreature.activate(input);
  let skewedFinalError = 0;
  for (let i = 0; i < target.length; i++) {
    skewedFinalError += Math.abs(skewedFinal[i] - target[i]);
  }

  // Both topologies should converge (error decreases).
  assert(
    uniformFinalError < uniformInitialError,
    `Uniform topology should converge: initial=${
      uniformInitialError.toFixed(4)
    }, final=${uniformFinalError.toFixed(4)}`,
  );
  assert(
    skewedFinalError < skewedInitialError,
    `Skewed topology should converge: initial=${
      skewedInitialError.toFixed(4)
    }, final=${skewedFinalError.toFixed(4)}`,
  );

  // Document convergence rates for comparison.
  const uniformReduction = 1 - (uniformFinalError / uniformInitialError);
  const skewedReduction = 1 - (skewedFinalError / skewedInitialError);
  console.log(
    `Convergence comparison over ${iterations} iterations:\n` +
      `  Uniform topology: error ${uniformInitialError.toFixed(4)} → ${
        uniformFinalError.toFixed(4)
      } ` +
      `(${(uniformReduction * 100).toFixed(1)}% reduction)\n` +
      `  Skewed topology:  error ${skewedInitialError.toFixed(4)} → ${
        skewedFinalError.toFixed(4)
      } ` +
      `(${(skewedReduction * 100).toFixed(1)}% reduction)`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: Large creature gradient statistics
// ---------------------------------------------------------------------------
Deno.test("GradientAccumulationScaling - large creature gradient statistics", async () => {
  // Load the existing large creature and its training data.
  const creatureJson = JSON.parse(
    await Deno.readTextFile("test/propagate/large/creature.json"),
  );
  const trainingData = JSON.parse(
    await Deno.readTextFile("test/propagate/large/td.json"),
  );
  const creature = Creature.fromJSON(creatureJson);

  const neuronCount = creature.neurons.length;
  const synapseCount = creature.synapses.length;
  const hiddenCount = neuronCount - creature.input - creature.output;

  assert(
    neuronCount > 100,
    `Expected large creature, got ${neuronCount} neurons`,
  );
  assert(synapseCount > 1000, `Expected many synapses, got ${synapseCount}`);

  // Compute fan-out for each non-input neuron.
  const fanOutCounts: number[] = [];
  for (let i = creature.input; i < neuronCount; i++) {
    const outward = creature.outwardConnections(i);
    fanOutCounts.push(outward.length);
  }

  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
  });
  const sparseConfig = new SparseConfig(creatureJson, config);

  // Use real training data to drive propagation through the network.
  // Multiple samples help generate error signals through more paths.
  for (
    const sample of trainingData as { input: number[]; output: number[] }[]
  ) {
    const input = new Float32Array(sample.input);
    const target = new Float32Array(sample.output);
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }

  // Collect totalErrorAbsolute for all non-input neurons.
  const errorValues: number[] = [];
  for (let i = creature.input; i < neuronCount; i++) {
    const ns = creature.state.node(i);
    errorValues.push(ns.totalErrorAbsolute);
  }

  const nonZeroErrors = errorValues.filter((e) => e > 0);

  // Fan-out statistics.
  const nonZeroFanOut = fanOutCounts.filter((c) => c > 0);
  const maxFanOut = Math.max(...fanOutCounts);
  const meanFanOut = fanOutCounts.reduce((a, b) => a + b, 0) /
    fanOutCounts.length;

  // Verify structural properties of the large network.
  assert(
    maxFanOut > 1,
    `Expected some neurons with fan-out > 1, max was ${maxFanOut}`,
  );
  assert(
    hiddenCount > 50,
    `Expected many hidden neurons, got ${hiddenCount}`,
  );

  // In a large, highly-connected network, most error signal concentrates
  // near the output neurons. Deep neurons may receive zero gradient due to
  // saturation — this is the core problem described in Issue #1869.
  const reachedPercentage = (nonZeroErrors.length / errorValues.length) * 100;

  console.log(
    `Large creature gradient statistics (${neuronCount} neurons, ${synapseCount} synapses):\n` +
      `  Hidden neurons: ${hiddenCount}\n` +
      `  Neurons reached by error signal: ${nonZeroErrors.length} / ${errorValues.length} ` +
      `(${reachedPercentage.toFixed(1)}%)\n` +
      `  Fan-out — max: ${maxFanOut}, mean: ${meanFanOut.toFixed(1)}, ` +
      `neurons with outward connections: ${nonZeroFanOut.length}`,
  );

  if (nonZeroErrors.length > 1) {
    const min = Math.min(...nonZeroErrors);
    const max = Math.max(...nonZeroErrors);
    const mean = nonZeroErrors.reduce((a, b) => a + b, 0) /
      nonZeroErrors.length;
    const variance = nonZeroErrors.reduce((a, b) => a + (b - mean) ** 2, 0) /
      nonZeroErrors.length;
    const stddev = Math.sqrt(variance);

    assert(Number.isFinite(max), `Max error should be finite, got ${max}`);
    assert(Number.isFinite(mean), `Mean error should be finite, got ${mean}`);

    const dynamicRange = max / min;
    console.log(
      `  Error accumulation — min: ${min.toExponential(3)}, max: ${
        max.toExponential(3)
      }, ` +
        `mean: ${mean.toExponential(3)}, stddev: ${stddev.toExponential(3)}\n` +
        `  Dynamic range: ${dynamicRange.toFixed(1)}x`,
    );
  }

  // The key diagnostic: gradient reach is limited in large saturated networks.
  // Even with training data, few neurons receive meaningful gradient signal,
  // confirming the gradient accumulation scaling challenge from Issue #1869.
  console.log(
    `  Diagnostic: ${
      (100 - reachedPercentage).toFixed(1)
    }% of neurons received zero gradient`,
  );
});
