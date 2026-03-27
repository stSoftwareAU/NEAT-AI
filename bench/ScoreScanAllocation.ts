/**
 * Benchmark for Score.ts scan function allocation elimination.
 * Issue #2042: Eliminate array slice + findIndex in Score.ts hot path.
 *
 * Measures the performance of scanMaxForBiasChange and scanMaxForWeightChange
 * which are called during incremental score updates when the max value changes.
 *
 * Usage:
 *   deno run -A bench/ScoreScanAllocation.ts
 */

import { Creature } from "../src/Creature.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "../src/architecture/Score.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";

function createCreature(hiddenPerLayer: number, layerCount: number): Creature {
  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    layers.push({ count: hiddenPerLayer, squash: IDENTITY.NAME });
  }
  return new Creature(50, 5, {
    layers,
    outputLayer: { squash: IDENTITY.NAME },
  });
}

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}us`;
  } else if (ms < 1000) {
    return `${ms.toFixed(3)}ms`;
  } else {
    return `${(ms / 1000).toFixed(3)}s`;
  }
}

/**
 * Benchmark bias change updates that trigger scanMaxForBiasChange.
 * Forces the scan path by making the old bias equal to the current max.
 */
function benchmarkBiasScan(
  creature: Creature,
  iterations: number,
): { totalMs: number; perIterMs: number } {
  const growthCost = 0.0001;
  const error = 0.1;

  // Initialise cache
  calculate(creature, error, growthCost);

  // Set up: make one neuron's bias the max, then force scan path
  // by setting secondMax to stale (-1) and reducing the max
  const targetNeuron = creature.neurons[creature.input];
  const bigBias = 100;
  targetNeuron.bias = bigBias;
  creature.invalidateScoreCache();
  calculate(creature, error, growthCost);

  // Now repeatedly: set the max bias high, invalidate secondMax, then reduce it
  // This forces scanMaxForBiasChange to be called each iteration
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Set up conditions that force a scan:
    // 1. Set bias to be the max
    const oldBias = bigBias + i * 0.001;
    targetNeuron.bias = oldBias;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);

    // 2. Mark secondMax as stale
    creature.cachedScoreComponents!.secondMaxWeightBias = -1;

    // 3. Now reduce the max - this triggers scanMaxForBiasChange
    const newBias = 0.5;
    updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);
    targetNeuron.bias = newBias;
  }
  const totalMs = performance.now() - start;

  return { totalMs, perIterMs: totalMs / iterations };
}

/**
 * Benchmark weight change updates that trigger scanMaxForWeightChange.
 */
function benchmarkWeightScan(
  creature: Creature,
  iterations: number,
): { totalMs: number; perIterMs: number } {
  const growthCost = 0.0001;
  const error = 0.1;

  // Initialise cache
  calculate(creature, error, growthCost);

  const targetSynapse = creature.synapses[0];
  const bigWeight = 100;
  targetSynapse.weight = bigWeight;
  creature.invalidateScoreCache();
  calculate(creature, error, growthCost);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const oldWeight = bigWeight + i * 0.001;
    targetSynapse.weight = oldWeight;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);

    // Mark secondMax as stale to force scan
    creature.cachedScoreComponents!.secondMaxWeightBias = -1;

    const newWeight = 0.5;
    updateScoreForWeightChange(
      creature,
      error,
      growthCost,
      oldWeight,
      newWeight,
    );
    targetSynapse.weight = newWeight;
  }
  const totalMs = performance.now() - start;

  return { totalMs, perIterMs: totalMs / iterations };
}

function runBenchmark() {
  console.log("=".repeat(70));
  console.log("Score Scan Allocation Benchmark (Issue #2042)");
  console.log("=".repeat(70));

  const sizes = [
    { hidden: 50, layers: 1, label: "Small (50 hidden)" },
    { hidden: 100, layers: 2, label: "Medium (200 hidden)" },
    { hidden: 125, layers: 4, label: "Large (500 hidden)" },
  ];

  const iterations = 500;

  // Warmup
  console.log("\nWarming up...");
  const warmup = createCreature(20, 1);
  benchmarkBiasScan(warmup, 50);
  benchmarkWeightScan(warmup, 50);

  console.log(`\nIterations per scenario: ${iterations}\n`);

  for (const size of sizes) {
    const creature = createCreature(size.hidden, size.layers);
    console.log(
      `\n--- ${size.label} (${creature.neurons.length} neurons, ${creature.synapses.length} synapses) ---`,
    );

    const biasResult = benchmarkBiasScan(
      createCreature(size.hidden, size.layers),
      iterations,
    );
    console.log(
      `  Bias scan:   ${formatDuration(biasResult.totalMs)} total, ${
        formatDuration(biasResult.perIterMs)
      }/iter`,
    );

    const weightResult = benchmarkWeightScan(
      createCreature(size.hidden, size.layers),
      iterations,
    );
    console.log(
      `  Weight scan: ${formatDuration(weightResult.totalMs)} total, ${
        formatDuration(weightResult.perIterMs)
      }/iter`,
    );
  }

  console.log("\n" + "=".repeat(70));
}

runBenchmark();
