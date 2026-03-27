/**
 * Benchmark for Float64Array allocation pooling in Score.ts extraction functions.
 * Issue #2046: Pool Float64Array allocations in score extraction functions.
 *
 * Measures the cost of extractWeights() and extractBiases() which allocate
 * new Float64Array instances on every call. These are called in the score
 * update hot path (weight/bias change scanning via computeAndCacheScoreComponents,
 * scanMaxForWeightChange, and scanMaxForBiasChange).
 *
 * Usage:
 *   deno run -A bench/ScoreExtractionPool.ts
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
 * Benchmark full score calculation (which calls extractWeights + extractBiases
 * internally via computeAndCacheScoreComponents).
 * Each iteration invalidates the cache to force re-extraction.
 */
function benchmarkScoreCalculation(
  creature: Creature,
  iterations: number,
): { totalMs: number; perIterMs: number } {
  const growthCost = 0.0001;
  const error = 0.1;

  // Warmup
  calculate(creature, error, growthCost);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);
  }
  const totalMs = performance.now() - start;
  return { totalMs, perIterMs: totalMs / iterations };
}

/**
 * Benchmark bias scan path (calls extractWeights + extractBiases via
 * scanMaxForBiasChange when secondMax is stale).
 */
function benchmarkBiasScanExtraction(
  creature: Creature,
  iterations: number,
): { totalMs: number; perIterMs: number } {
  const growthCost = 0.0001;
  const error = 0.1;

  calculate(creature, error, growthCost);

  const targetNeuron = creature.neurons[creature.input];
  const bigBias = 100;
  targetNeuron.bias = bigBias;
  creature.invalidateScoreCache();
  calculate(creature, error, growthCost);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const oldBias = bigBias + i * 0.001;
    targetNeuron.bias = oldBias;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);

    creature.cachedScoreComponents!.secondMaxWeightBias = -1;

    const newBias = 0.5;
    updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);
    targetNeuron.bias = newBias;
  }
  const totalMs = performance.now() - start;
  return { totalMs, perIterMs: totalMs / iterations };
}

/**
 * Benchmark weight scan path (calls extractWeights + extractBiases via
 * scanMaxForWeightChange when secondMax is stale).
 */
function benchmarkWeightScanExtraction(
  creature: Creature,
  iterations: number,
): { totalMs: number; perIterMs: number } {
  const growthCost = 0.0001;
  const error = 0.1;

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
  console.log("Score Extraction Float64Array Pool Benchmark (Issue #2046)");
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
  benchmarkScoreCalculation(warmup, 50);
  benchmarkBiasScanExtraction(warmup, 50);
  benchmarkWeightScanExtraction(warmup, 50);

  console.log(`\nIterations per scenario: ${iterations}\n`);

  for (const size of sizes) {
    const creature = createCreature(size.hidden, size.layers);
    console.log(
      `\n--- ${size.label} (${creature.neurons.length} neurons, ${creature.synapses.length} synapses) ---`,
    );

    const calcResult = benchmarkScoreCalculation(
      createCreature(size.hidden, size.layers),
      iterations,
    );
    console.log(
      `  Score calc:  ${formatDuration(calcResult.totalMs)} total, ${
        formatDuration(calcResult.perIterMs)
      }/iter`,
    );

    const biasResult = benchmarkBiasScanExtraction(
      createCreature(size.hidden, size.layers),
      iterations,
    );
    console.log(
      `  Bias scan:   ${formatDuration(biasResult.totalMs)} total, ${
        formatDuration(biasResult.perIterMs)
      }/iter`,
    );

    const weightResult = benchmarkWeightScanExtraction(
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
