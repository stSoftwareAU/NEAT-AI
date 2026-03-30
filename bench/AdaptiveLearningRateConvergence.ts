/**
 * Issue #1480 - Adaptive Learning Rate Scaling Benchmark
 *
 * Compares backpropagation convergence across different learning rate
 * configurations and error-proportional scaling strategies, to determine
 * whether error-magnitude-based scaling improves convergence.
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-write bench/AdaptiveLearningRateConvergence.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  type BackPropagationOptions,
  calculateLearningRate,
  createBackPropagationConfig,
  type ErrorFeedback,
} from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

// Simple target: input 0.5 -> output 0.3
const INPUT = new Float32Array([0.5]);
const TARGET = new Float32Array([0.3]);
const TRAINING_ITERATIONS = 200;
const TRIALS = 10;

interface TrialResult {
  name: string;
  meanFinalError: number;
  bestFinalError: number;
  worstFinalError: number;
}

function createCreature(): Creature {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
    ],
  };
  return Creature.fromJSON(json);
}

function runTrial(
  name: string,
  options: BackPropagationOptions,
): TrialResult {
  const finalErrors: number[] = [];

  for (let trial = 0; trial < TRIALS; trial++) {
    const creature = createCreature();
    const config = createBackPropagationConfig({
      generations: 0,
      disableRandomSamples: true,
      batchSize: 1,
      ...options,
    });

    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    let previousError: number | undefined;

    for (let i = 0; i < TRAINING_ITERATIONS; i++) {
      creature.activateAndTrace(INPUT, false, sparseConfig);
      creature.propagate(TARGET, config, sparseConfig);

      // Calculate current error for adaptive feedback
      const output = creature.activate(INPUT);
      const currentError = Math.abs(output[0] - TARGET[0]);

      // Build feedback for the next iteration's learning rate calculation
      const errorFeedback: ErrorFeedback | undefined =
        previousError !== undefined
          ? { previousError, currentError }
          : undefined;

      const currentLR = calculateLearningRate(config, i, errorFeedback);
      // Create iteration-specific config with the calculated learning rate
      const iterConfig = createBackPropagationConfig({
        ...config,
        learningRate: currentLR,
      });

      creature.activateAndTrace(INPUT, false, sparseConfig);
      creature.propagate(TARGET, iterConfig, sparseConfig);

      previousError = currentError;
    }

    creature.propagateUpdate(config, sparseConfig);
    creature.clearState();

    const finalOutput = creature.activate(INPUT);
    const finalError = Math.abs(finalOutput[0] - TARGET[0]);
    finalErrors.push(finalError);
  }

  const mean = finalErrors.reduce((a, b) => a + b, 0) / finalErrors.length;
  const best = Math.min(...finalErrors);
  const worst = Math.max(...finalErrors);

  return {
    name,
    meanFinalError: mean,
    bestFinalError: best,
    worstFinalError: worst,
  };
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1480: Adaptive Learning Rate Scaling Benchmark");
console.log("=".repeat(70));
console.log(
  `Problem: input=0.5 -> target=0.3 (LOGISTIC hidden, IDENTITY output)`,
);
console.log(
  `Iterations: ${TRAINING_ITERATIONS}, Trials per config: ${TRIALS}`,
);
console.log();

const configs: { name: string; options: BackPropagationOptions }[] = [
  {
    name: "Fixed LR=0.01 (default)",
    options: { learningRate: 0.01, learningRateStrategy: "fixed" },
  },
  {
    name: "Fixed LR=0.001",
    options: { learningRate: 0.001, learningRateStrategy: "fixed" },
  },
  {
    name: "Fixed LR=0.1",
    options: { learningRate: 0.1, learningRateStrategy: "fixed" },
  },
  {
    name: "Decay (default)",
    options: { learningRateStrategy: "decay" },
  },
  {
    name: "Adaptive (with magnitude)",
    options: { learningRateStrategy: "adaptive" },
  },
  {
    name: "Warm restart (default)",
    options: { learningRateStrategy: "warm_restart" },
  },
];

const results: TrialResult[] = [];
for (const cfg of configs) {
  const result = runTrial(cfg.name, cfg.options);
  results.push(result);
  console.log(
    `${result.name.padEnd(35)} | mean=${
      result.meanFinalError.toFixed(6)
    } | best=${result.bestFinalError.toFixed(6)} | worst=${
      result.worstFinalError.toFixed(6)
    }`,
  );
}

console.log("\n" + "=".repeat(70));
console.log("Benchmark complete.");
console.log("=".repeat(70) + "\n");
