/**
 * Benchmark for pooled Float64Array allocations in Score.ts.
 * Issue #2126: Measures the performance improvement from pooling
 * Float64Array allocations in extractWeights() and extractBiases().
 *
 * Usage:
 *   deno run -A bench/ScorePooledBuffers.ts
 */

import { Creature } from "@creature";
import {
  calculate,
  resetPoolBuffers,
  updateScoreForBiasChange,
} from "@architecture/Score.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

interface CreatureSpec {
  name: string;
  inputs: number;
  outputs: number;
  layers: { count: number; squash: string }[];
}

const SPECS: CreatureSpec[] = [
  {
    name: "Small",
    inputs: 10,
    outputs: 5,
    layers: [
      { count: 25, squash: IDENTITY.NAME },
      { count: 10, squash: IDENTITY.NAME },
    ],
  },
  {
    name: "Medium",
    inputs: 25,
    outputs: 5,
    layers: [
      { count: 50, squash: IDENTITY.NAME },
      { count: 30, squash: IDENTITY.NAME },
      { count: 15, squash: IDENTITY.NAME },
    ],
  },
  {
    name: "Large",
    inputs: 50,
    outputs: 10,
    layers: [
      { count: 100, squash: IDENTITY.NAME },
      { count: 75, squash: IDENTITY.NAME },
      { count: 50, squash: IDENTITY.NAME },
      { count: 25, squash: IDENTITY.NAME },
    ],
  },
];

function createCreature(spec: CreatureSpec): Creature {
  const creature = new Creature(spec.inputs, spec.outputs, {
    layers: spec.layers,
    outputLayer: { squash: IDENTITY.NAME },
  });
  // Set random weights/biases for realistic data
  for (let i = 0; i < creature.synapses.length; i++) {
    creature.synapses[i].weight = (Math.random() - 0.5) * 4;
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = (Math.random() - 0.5) * 2;
  }
  return creature;
}

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)} µs`;
  }
  return `${ms.toFixed(3)} ms`;
}

function benchmarkScoreCalculation(
  creature: Creature,
  iterations: number,
): number {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    // Clear cache to force fresh extraction each time
    creature.invalidateScoreCache();
    const start = performance.now();
    calculate(creature, Math.random() * 0.3, 0.0001);
    times.push(performance.now() - start);
  }
  return times.reduce((a, b) => a + b, 0) / iterations;
}

function benchmarkBiasScan(
  creature: Creature,
  iterations: number,
): number {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    // Set up a bias change scenario that triggers a full scan
    const neuronIdx = creature.input;
    const oldBias = creature.neurons[neuronIdx].bias;
    const newBias = oldBias * 0.5;

    // Clear cache and compute initial
    creature.invalidateScoreCache();
    calculate(creature, 0.1, 0.001);

    // Force max to match oldBias so scan is triggered
    creature.cachedScoreComponents!.maxWeightBias = Math.abs(oldBias);
    creature.cachedScoreComponents!.secondMaxWeightBias = -1;

    creature.neurons[neuronIdx].bias = newBias;

    const start = performance.now();
    updateScoreForBiasChange(creature, 0.1, 0.001, oldBias, newBias);
    times.push(performance.now() - start);

    // Restore for next iteration
    creature.neurons[neuronIdx].bias = oldBias;
    creature.invalidateScoreCache();
  }
  return times.reduce((a, b) => a + b, 0) / iterations;
}

function run() {
  console.log("=".repeat(65));
  console.log("Pooled Float64Array Allocation Benchmark (Issue #2126)");
  console.log("=".repeat(65));
  console.log();

  const iterations = 500;
  const warmupIterations = 50;

  const results: {
    name: string;
    synapses: number;
    neurons: number;
    scoreCalcAvg: string;
    biasScanAvg: string;
  }[] = [];

  for (const spec of SPECS) {
    const creature = createCreature(spec);
    const numSynapses = creature.synapses.length;
    const numNeurons = creature.neurons.length;

    console.log(
      `${spec.name} (${numSynapses} synapses, ${numNeurons} neurons)`,
    );
    console.log("-".repeat(50));

    // Warmup
    resetPoolBuffers();
    for (let i = 0; i < warmupIterations; i++) {
      creature.invalidateScoreCache();
      calculate(creature, Math.random() * 0.3, 0.0001);
    }

    // Benchmark score calculation (pools are warm)
    const scoreAvg = benchmarkScoreCalculation(creature, iterations);
    console.log(
      `  Score calculation (${iterations} iterations): ${
        formatDuration(scoreAvg)
      }`,
    );

    // Benchmark bias scan (triggers extractWeights + extractBiases)
    const biasAvg = benchmarkBiasScan(creature, iterations);
    console.log(
      `  Bias scan (${iterations} iterations):         ${
        formatDuration(biasAvg)
      }`,
    );
    console.log();

    results.push({
      name: spec.name,
      synapses: numSynapses,
      neurons: numNeurons,
      scoreCalcAvg: formatDuration(scoreAvg),
      biasScanAvg: formatDuration(biasAvg),
    });
  }

  // Summary table
  console.log("=".repeat(65));
  console.log("Summary (with pooled buffers)");
  console.log("=".repeat(65));
  console.log();
  console.log(
    "| Scenario | Synapses | Score Calc | Bias Scan |",
  );
  console.log(
    "|----------|----------|------------|-----------|",
  );
  for (const r of results) {
    console.log(
      `| ${r.name.padEnd(8)} | ${String(r.synapses).padEnd(8)} | ${
        r.scoreCalcAvg.padEnd(10)
      } | ${r.biasScanAvg.padEnd(9)} |`,
    );
  }
  console.log();
}

run();
