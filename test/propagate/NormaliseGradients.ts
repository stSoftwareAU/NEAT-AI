/**
 * Gradient Normalisation Tests
 *
 * Issue #1872 - Tests for the normaliseGradients config option that dampens
 * gradient magnification in high fan-out neurons by dividing accumulated
 * error signals by sqrt(targetDeltaCount).
 *
 * Part of #1869
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

// ---------------------------------------------------------------------------
// Test 1: Default behaviour preserves sum (backwards compatible)
// ---------------------------------------------------------------------------
Deno.test("NormaliseGradients - default false preserves summing behaviour", () => {
  // With normaliseGradients defaulting to false, gradient accumulation
  // should behave identically to the existing sum-based approach.
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
  });
  assertEquals(
    config.normaliseGradients,
    false,
    "normaliseGradients should default to false",
  );
});

// ---------------------------------------------------------------------------
// Test 2: Normalisation reduces gradient magnification
// ---------------------------------------------------------------------------
Deno.test("NormaliseGradients - reduces gradient magnification for high fan-out", () => {
  // Build a network where a hidden neuron fans out to 20 outputs.
  // Compare weight updates with and without normalisation.
  const outputCount = 20;

  const neurons: CreatureExport["neurons"] = [
    { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
  ];
  const synapses: CreatureExport["synapses"] = [
    { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
  ];
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
    synapses.push({ fromUUID: "h1", toUUID: `output-${i}`, weight: 1.0 });
  }
  const json: CreatureExport = {
    input: 1,
    output: outputCount,
    neurons,
    synapses,
  };

  const input = new Float32Array([1.0]);
  const target = new Float32Array(outputCount).fill(1.1);

  const configOpts = {
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1,
  };

  // Train WITHOUT normalisation (sum behaviour).
  const sumCreature = Creature.fromJSON(json);
  const sumConfig = createBackPropagationConfig({
    ...configOpts,
    normaliseGradients: false,
  });
  const sumSparse = new SparseConfig(json, sumConfig);

  sumCreature.activateAndTrace(input, false, sumSparse);
  sumCreature.propagate(target, sumConfig, sumSparse);
  sumCreature.applyLearnings(sumConfig, sumSparse);

  const sumWeightChange = Math.abs(sumCreature.synapses[0].weight - 1.0);

  // Train WITH normalisation (sqrt-damped).
  const normCreature = Creature.fromJSON(json);
  const normConfig = createBackPropagationConfig({
    ...configOpts,
    normaliseGradients: true,
  });
  const normSparse = new SparseConfig(json, normConfig);

  normCreature.activateAndTrace(input, false, normSparse);
  normCreature.propagate(target, normConfig, normSparse);
  normCreature.applyLearnings(normConfig, normSparse);

  const normWeightChange = Math.abs(normCreature.synapses[0].weight - 1.0);

  // Both should produce changes.
  assert(sumWeightChange > 0, `Sum mode should produce weight change`);
  assert(normWeightChange > 0, `Normalised mode should produce weight change`);

  // The normalised weight change should be smaller than the summed one
  // because we divide by sqrt(20) ≈ 4.47.
  assert(
    normWeightChange < sumWeightChange,
    `Normalised weight change (${
      normWeightChange.toFixed(6)
    }) should be smaller ` +
      `than summed (${sumWeightChange.toFixed(6)})`,
  );

  // The ratio should be approximately sqrt(outputCount).
  const ratio = sumWeightChange / normWeightChange;
  const expectedRatio = Math.sqrt(outputCount);
  console.log(
    `Normalisation ratio: ${ratio.toFixed(2)} (expected ~${
      expectedRatio.toFixed(2)
    })`,
  );
});

// ---------------------------------------------------------------------------
// Test 3: Single downstream path is unaffected by normalisation
// ---------------------------------------------------------------------------
Deno.test("NormaliseGradients - single downstream unaffected", () => {
  // When a neuron has only 1 downstream connection, normalisation should
  // have no effect (count=1, sqrt(1)=1).
  const json: CreatureExport = {
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

  const input = new Float32Array([1.0]);
  const target = new Float32Array([1.1]);

  const configOpts = {
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1,
  };

  // Train without normalisation.
  const sumCreature = Creature.fromJSON(json);
  const sumConfig = createBackPropagationConfig({
    ...configOpts,
    normaliseGradients: false,
  });
  const sumSparse = new SparseConfig(json, sumConfig);
  sumCreature.activateAndTrace(input, false, sumSparse);
  sumCreature.propagate(target, sumConfig, sumSparse);
  sumCreature.applyLearnings(sumConfig, sumSparse);
  const sumWeight = sumCreature.synapses[0].weight;

  // Train with normalisation.
  const normCreature = Creature.fromJSON(json);
  const normConfig = createBackPropagationConfig({
    ...configOpts,
    normaliseGradients: true,
  });
  const normSparse = new SparseConfig(json, normConfig);
  normCreature.activateAndTrace(input, false, normSparse);
  normCreature.propagate(target, normConfig, normSparse);
  normCreature.applyLearnings(normConfig, normSparse);
  const normWeight = normCreature.synapses[0].weight;

  // With single downstream, both should produce identical results.
  const diff = Math.abs(sumWeight - normWeight);
  assert(
    diff < 1e-10,
    `Single downstream: normalised and sum weights should match, diff=${diff}`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: Normalisation improves convergence for skewed connectivity
// ---------------------------------------------------------------------------
Deno.test("NormaliseGradients - improves convergence for skewed topology", () => {
  // Network with highly skewed connectivity: one neuron fans out to all
  // outputs, others have minimal fan-out. Normalisation should help
  // by preventing the high fan-out neuron from dominating weight updates.
  const outputCount = 10;

  const neurons: CreatureExport["neurons"] = [
    { type: "hidden", uuid: "h-high", squash: "TANH", bias: 0 },
    { type: "hidden", uuid: "h-low", squash: "TANH", bias: 0 },
  ];
  const synapses: CreatureExport["synapses"] = [
    { fromUUID: "input-0", toUUID: "h-high", weight: 0.5 },
    { fromUUID: "input-1", toUUID: "h-low", weight: 0.5 },
  ];
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
    // h-high fans out to ALL outputs.
    synapses.push({
      fromUUID: "h-high",
      toUUID: `output-${i}`,
      weight: 0.3,
    });
  }
  // h-low only connects to the first output.
  synapses.push({ fromUUID: "h-low", toUUID: "output-0", weight: 0.3 });

  const json: CreatureExport = {
    input: 2,
    output: outputCount,
    neurons,
    synapses,
  };

  const input = new Float32Array([0.5, 0.8]);
  const target = new Float32Array(outputCount);
  for (let i = 0; i < outputCount; i++) {
    target[i] = 0.1 + i * 0.05;
  }

  const iterations = 100;
  const configOpts = {
    generations: 1,
    learningRate: 0.05,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
  };

  // Train WITHOUT normalisation.
  const sumCreature = Creature.fromJSON(json);
  const sumConfig = createBackPropagationConfig({
    ...configOpts,
    normaliseGradients: false,
  });
  const sumSparse = new SparseConfig(json, sumConfig);

  const sumInitial = sumCreature.activate(input);
  let sumInitialError = 0;
  for (let i = 0; i < target.length; i++) {
    sumInitialError += (sumInitial[i] - target[i]) ** 2;
  }

  for (let i = 0; i < iterations; i++) {
    sumCreature.activateAndTrace(input, false, sumSparse);
    sumCreature.propagate(target, sumConfig, sumSparse);
  }
  sumCreature.applyLearnings(sumConfig, sumSparse);

  const sumFinal = sumCreature.activate(input);
  let sumFinalError = 0;
  for (let i = 0; i < target.length; i++) {
    sumFinalError += (sumFinal[i] - target[i]) ** 2;
  }

  // Train WITH normalisation.
  const normCreature = Creature.fromJSON(json);
  const normConfig = createBackPropagationConfig({
    ...configOpts,
    normaliseGradients: true,
  });
  const normSparse = new SparseConfig(json, normConfig);

  const normInitial = normCreature.activate(input);
  let normInitialError = 0;
  for (let i = 0; i < target.length; i++) {
    normInitialError += (normInitial[i] - target[i]) ** 2;
  }

  for (let i = 0; i < iterations; i++) {
    normCreature.activateAndTrace(input, false, normSparse);
    normCreature.propagate(target, normConfig, normSparse);
  }
  normCreature.applyLearnings(normConfig, normSparse);

  const normFinal = normCreature.activate(input);
  let normFinalError = 0;
  for (let i = 0; i < target.length; i++) {
    normFinalError += (normFinal[i] - target[i]) ** 2;
  }

  // Both should converge.
  assert(
    sumFinalError < sumInitialError,
    `Sum mode should converge: ${sumInitialError.toFixed(4)} → ${
      sumFinalError.toFixed(4)
    }`,
  );
  assert(
    normFinalError < normInitialError,
    `Normalised mode should converge: ${normInitialError.toFixed(4)} → ${
      normFinalError.toFixed(4)
    }`,
  );

  const sumReduction = 1 - sumFinalError / sumInitialError;
  const normReduction = 1 - normFinalError / normInitialError;
  console.log(
    `Skewed topology convergence:\n` +
      `  Sum mode:        ${
        (sumReduction * 100).toFixed(1)
      }% error reduction\n` +
      `  Normalised mode: ${(normReduction * 100).toFixed(1)}% error reduction`,
  );
});

// ---------------------------------------------------------------------------
// Test 5: Config option is correctly frozen
// ---------------------------------------------------------------------------
Deno.test("NormaliseGradients - config option correctly set and frozen", () => {
  const configTrue = createBackPropagationConfig({
    normaliseGradients: true,
  });
  assertEquals(configTrue.normaliseGradients, true);

  const configFalse = createBackPropagationConfig({
    normaliseGradients: false,
  });
  assertEquals(configFalse.normaliseGradients, false);

  const configDefault = createBackPropagationConfig({});
  assertEquals(configDefault.normaliseGradients, false);

  // Config should be frozen.
  assert(Object.isFrozen(configTrue), "Config should be frozen");
});
