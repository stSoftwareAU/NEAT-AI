/**
 * Issue #1656 - Cosine Annealing vs Exponential Decay Warm Restart Benchmark
 *
 * Compares convergence of:
 *   1. Current exponential decay warm restart
 *   2. Proposed cosine annealing warm restart (SGDR / Loshchilov & Hutter 2017)
 *
 * The cosine schedule: lr = lr_min + 0.5 * (lr_max - lr_min) * (1 + cos(π * T_cur / T_i))
 * decays slowly at first, accelerates in the middle, and slows near the minimum.
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-write bench/CosineAnnealingWarmRestart.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import type {
  BackPropagationArguments,
  BackPropagationConfig,
  BackPropagationOptions,
} from "../src/propagate/BackPropagation.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

const TRAINING_ITERATIONS = 500;
const TRIALS = 20;

interface TrialResult {
  name: string;
  meanFinalError: number;
  bestFinalError: number;
  worstFinalError: number;
  medianFinalError: number;
}

/**
 * Exponential decay learning rate (current implementation).
 */
function exponentialLR(
  config: BackPropagationConfig,
  iteration: number,
): number {
  const period = config.warmRestartPeriod;
  const positionInPeriod = iteration % period;
  return config.initialLearningRate *
    Math.pow(config.learningRateDecay, positionInPeriod);
}

/**
 * Cosine annealing learning rate (proposed replacement).
 * lr = lr_min + 0.5 * (lr_max - lr_min) * (1 + cos(π * T_cur / T_i))
 * where lr_min is approximated as initialLearningRate * learningRateDecay^period.
 */
function cosineAnnealingLR(
  config: BackPropagationConfig,
  iteration: number,
): number {
  const period = config.warmRestartPeriod;
  const positionInPeriod = iteration % period;
  const lrMax = config.initialLearningRate;
  const lrMin = lrMax * Math.pow(config.learningRateDecay, period);
  return lrMin +
    0.5 * (lrMax - lrMin) *
      (1 + Math.cos(Math.PI * positionInPeriod / period));
}

/**
 * Create a production-sized creature with multiple hidden layers.
 */
function createProductionCreature(): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      // Hidden layer 1
      { type: "hidden", uuid: "h1-0", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "h1-1", squash: "LOGISTIC", bias: -0.1 },
      { type: "hidden", uuid: "h1-2", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "h1-3", squash: "LOGISTIC", bias: 0.2 },
      // Hidden layer 2
      { type: "hidden", uuid: "h2-0", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "h2-1", squash: "LOGISTIC", bias: -0.05 },
      { type: "hidden", uuid: "h2-2", squash: "LOGISTIC", bias: 0.05 },
      // Output
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // Input -> Hidden layer 1
      { fromUUID: "input-0", toUUID: "h1-0", weight: 0.3 },
      { fromUUID: "input-0", toUUID: "h1-1", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "h1-1", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "h1-2", weight: 0.1 },
      { fromUUID: "input-2", toUUID: "h1-2", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "h1-3", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "h1-3", weight: -0.1 },
      // Hidden layer 1 -> Hidden layer 2
      { fromUUID: "h1-0", toUUID: "h2-0", weight: 0.4 },
      { fromUUID: "h1-1", toUUID: "h2-0", weight: -0.3 },
      { fromUUID: "h1-1", toUUID: "h2-1", weight: 0.2 },
      { fromUUID: "h1-2", toUUID: "h2-1", weight: 0.5 },
      { fromUUID: "h1-2", toUUID: "h2-2", weight: -0.1 },
      { fromUUID: "h1-3", toUUID: "h2-2", weight: 0.3 },
      // Hidden layer 2 -> Output
      { fromUUID: "h2-0", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "h2-1", toUUID: "output-0", weight: -0.4 },
      { fromUUID: "h2-1", toUUID: "output-1", weight: 0.3 },
      { fromUUID: "h2-2", toUUID: "output-1", weight: 0.5 },
    ],
  };
  return Creature.fromJSON(json);
}

// Multiple training patterns for a more realistic benchmark
const TRAINING_DATA = [
  {
    input: new Float32Array([0.2, 0.8, 0.5]),
    target: new Float32Array([0.3, 0.7]),
  },
  {
    input: new Float32Array([0.9, 0.1, 0.4]),
    target: new Float32Array([0.8, 0.2]),
  },
  {
    input: new Float32Array([0.5, 0.5, 0.5]),
    target: new Float32Array([0.5, 0.5]),
  },
  {
    input: new Float32Array([0.1, 0.3, 0.9]),
    target: new Float32Array([0.2, 0.8]),
  },
  {
    input: new Float32Array([0.7, 0.6, 0.1]),
    target: new Float32Array([0.6, 0.4]),
  },
];

function calculateError(creature: Creature): number {
  let totalError = 0;
  for (const { input, target } of TRAINING_DATA) {
    const output = creature.activate(input);
    for (let j = 0; j < target.length; j++) {
      totalError += Math.abs(output[j] - target[j]);
    }
  }
  return totalError / TRAINING_DATA.length;
}

type LRFunction = (config: BackPropagationConfig, iteration: number) => number;

function runTrial(
  name: string,
  options: BackPropagationOptions,
  lrFn: LRFunction,
): TrialResult {
  const finalErrors: number[] = [];

  for (let trial = 0; trial < TRIALS; trial++) {
    const creature = createProductionCreature();
    const baseConfig = createBackPropagationConfig({
      generations: 0,
      disableRandomSamples: true,
      batchSize: 1,
      learningRateStrategy: "fixed", // We control LR manually
      ...options,
    });

    const sparseConfig = new SparseConfig(creature.exportJSON(), baseConfig);

    // Mutable iteration config to avoid allocation per iteration
    const iterConfig: BackPropagationArguments = { ...baseConfig };

    for (let i = 0; i < TRAINING_ITERATIONS; i++) {
      const dataIdx = i % TRAINING_DATA.length;
      const { input, target } = TRAINING_DATA[dataIdx];

      // Compute the learning rate from the schedule function
      iterConfig.learningRate = lrFn(baseConfig, i);

      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(target, iterConfig, sparseConfig);
    }

    creature.propagateUpdate(baseConfig, sparseConfig);
    creature.clearState();

    finalErrors.push(calculateError(creature));
  }

  finalErrors.sort((a, b) => a - b);
  const mean = finalErrors.reduce((a, b) => a + b, 0) / finalErrors.length;
  const median = finalErrors[Math.floor(finalErrors.length / 2)];

  return {
    name,
    meanFinalError: mean,
    bestFinalError: finalErrors[0],
    worstFinalError: finalErrors[finalErrors.length - 1],
    medianFinalError: median,
  };
}

// Show the learning rate curves for comparison
function printLearningRateCurves(): void {
  const config = createBackPropagationConfig({
    learningRateStrategy: "warm_restart",
    initialLearningRate: 0.01,
    learningRateDecay: 0.95,
    warmRestartPeriod: 10,
  });

  console.log("\nLearning Rate Curves (period=10, decay=0.95, initial=0.01):");
  console.log("-".repeat(60));
  console.log("Iter | Exponential     | Cosine Annealing");
  console.log("-".repeat(60));
  for (let i = 0; i < 20; i++) {
    const expLR = exponentialLR(config, i);
    const cosLR = cosineAnnealingLR(config, i);
    console.log(
      `  ${String(i).padStart(2)} | ${expLR.toFixed(8).padStart(14)} | ${
        cosLR.toFixed(8).padStart(14)
      }`,
    );
  }
  console.log();
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1656: Cosine Annealing vs Exponential Warm Restart");
console.log("=".repeat(70));
console.log(
  `Creature: 3 inputs, 4+3 hidden (LOGISTIC), 2 outputs (IDENTITY)`,
);
console.log(
  `Iterations: ${TRAINING_ITERATIONS}, Trials: ${TRIALS}, Data patterns: ${TRAINING_DATA.length}`,
);

printLearningRateCurves();

const configs: { label: string; options: BackPropagationOptions }[] = [
  {
    label: "initial=0.01, decay=0.95, period=10",
    options: {
      initialLearningRate: 0.01,
      learningRateDecay: 0.95,
      warmRestartPeriod: 10,
    },
  },
  {
    label: "initial=0.01, decay=0.9, period=20",
    options: {
      initialLearningRate: 0.01,
      learningRateDecay: 0.9,
      warmRestartPeriod: 20,
    },
  },
  {
    label: "initial=0.05, decay=0.95, period=10",
    options: {
      initialLearningRate: 0.05,
      learningRateDecay: 0.95,
      warmRestartPeriod: 10,
    },
  },
  {
    label: "initial=0.05, decay=0.9, period=50",
    options: {
      initialLearningRate: 0.05,
      learningRateDecay: 0.9,
      warmRestartPeriod: 50,
    },
  },
];

interface ComparisonResult {
  config: string;
  exponential: TrialResult;
  cosine: TrialResult;
}

const allResults: ComparisonResult[] = [];

for (const { label, options } of configs) {
  console.log(`\nConfig: ${label}`);
  console.log("-".repeat(70));

  const expResult = runTrial(
    "Exponential warm restart",
    options,
    exponentialLR,
  );
  const cosResult = runTrial(
    "Cosine annealing warm restart",
    options,
    cosineAnnealingLR,
  );

  allResults.push({ config: label, exponential: expResult, cosine: cosResult });

  for (const r of [expResult, cosResult]) {
    console.log(
      `  ${r.name.padEnd(35)} | mean=${r.meanFinalError.toFixed(6)} | median=${
        r.medianFinalError.toFixed(6)
      } | best=${r.bestFinalError.toFixed(6)} | worst=${
        r.worstFinalError.toFixed(6)
      }`,
    );
  }

  const improvement = ((expResult.meanFinalError - cosResult.meanFinalError) /
    expResult.meanFinalError * 100).toFixed(1);
  console.log(
    `  => Cosine ${
      Number(improvement) > 0 ? "better" : "worse"
    } by ${improvement}% (mean error)`,
  );
}

console.log("\n" + "=".repeat(70));
console.log("Summary:");
console.log("=".repeat(70));

let cosineWins = 0;
for (const r of allResults) {
  const better = r.cosine.meanFinalError < r.exponential.meanFinalError;
  if (better) cosineWins++;
  console.log(
    `  ${r.config}: ${better ? "COSINE wins" : "EXPONENTIAL wins"}`,
  );
}

console.log(
  `\nCosine annealing wins in ${cosineWins}/${allResults.length} configurations.`,
);
console.log("=".repeat(70) + "\n");
