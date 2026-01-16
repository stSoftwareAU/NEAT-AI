/**
 * Benchmark for incremental score update performance.
 * Issue #1045: Implement incremental score update for weight-only mutations.
 *
 * This benchmark measures the performance improvement from using incremental
 * updates for weight/bias changes instead of full recalculation.
 *
 * Usage:
 *   deno run -A bench/IncrementalScoreUpdate.ts
 */

import { Creature } from "../src/Creature.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "../src/architecture/Score.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";

function createLargeCreature(): Creature {
  // Create a creature similar to what might exist in production
  // (the issue mentions 619 neurons + 17,935 synapses as an example)
  const creature = new Creature(50, 5, {
    layers: [
      { count: 100, squash: IDENTITY.NAME },
      { count: 50, squash: IDENTITY.NAME },
      { count: 25, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

function createVeryLargeCreature(): Creature {
  // Create a very large creature to stress-test the optimisation
  const creature = new Creature(100, 10, {
    layers: [
      { count: 200, squash: IDENTITY.NAME },
      { count: 150, squash: IDENTITY.NAME },
      { count: 100, squash: IDENTITY.NAME },
      { count: 50, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(3)}ms`;
  } else {
    return `${(ms / 1000).toFixed(3)}s`;
  }
}

interface BenchmarkResult {
  scenario: string;
  creature: {
    neurons: number;
    synapses: number;
    hiddenNeurons: number;
  };
  iterations: number;
  incrementalTime: number;
  fullRecalcTime: number;
  speedup: number;
  percentImprovement: number;
}

function benchmarkWeightMutations(
  creature: Creature,
  iterations: number,
): BenchmarkResult {
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score to populate cache
  calculate(creature, error, growthCost);

  // Store original weights for restoration
  const originalWeights = creature.synapses.map((s) => s.weight);

  // Benchmark incremental updates
  const incrementalStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const synapse = creature.synapses[i % creature.synapses.length];
    const oldWeight = synapse.weight;
    const newWeight = oldWeight + (Math.random() - 0.5) * 0.2;
    updateScoreForWeightChange(
      creature,
      error,
      growthCost,
      oldWeight,
      newWeight,
    );
    synapse.weight = newWeight;
  }
  const incrementalTime = performance.now() - incrementalStart;

  // Restore original weights
  for (let i = 0; i < creature.synapses.length; i++) {
    creature.synapses[i].weight = originalWeights[i];
  }

  // Benchmark full recalculations
  const fullRecalcStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const synapse = creature.synapses[i % creature.synapses.length];
    synapse.weight += (Math.random() - 0.5) * 0.2;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);
  }
  const fullRecalcTime = performance.now() - fullRecalcStart;

  const speedup = fullRecalcTime / incrementalTime;
  const percentImprovement =
    ((fullRecalcTime - incrementalTime) / fullRecalcTime) * 100;

  return {
    scenario: "Weight mutations",
    creature: {
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      hiddenNeurons: creature.neurons.length - creature.input - creature.output,
    },
    iterations,
    incrementalTime,
    fullRecalcTime,
    speedup,
    percentImprovement,
  };
}

function benchmarkBiasMutations(
  creature: Creature,
  iterations: number,
): BenchmarkResult {
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score to populate cache
  calculate(creature, error, growthCost);

  // Get non-input neurons for bias mutation
  const nonInputNeurons = creature.neurons.slice(creature.input);

  // Store original biases for restoration
  const originalBiases = nonInputNeurons.map((n) => n.bias);

  // Benchmark incremental updates
  const incrementalStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const neuron = nonInputNeurons[i % nonInputNeurons.length];
    const oldBias = neuron.bias;
    const newBias = oldBias + (Math.random() - 0.5) * 0.2;
    updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);
    neuron.bias = newBias;
  }
  const incrementalTime = performance.now() - incrementalStart;

  // Restore original biases
  for (let i = 0; i < nonInputNeurons.length; i++) {
    nonInputNeurons[i].bias = originalBiases[i];
  }

  // Benchmark full recalculations
  const fullRecalcStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const neuron = nonInputNeurons[i % nonInputNeurons.length];
    neuron.bias += (Math.random() - 0.5) * 0.2;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);
  }
  const fullRecalcTime = performance.now() - fullRecalcStart;

  const speedup = fullRecalcTime / incrementalTime;
  const percentImprovement =
    ((fullRecalcTime - incrementalTime) / fullRecalcTime) * 100;

  return {
    scenario: "Bias mutations",
    creature: {
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      hiddenNeurons: creature.neurons.length - creature.input - creature.output,
    },
    iterations,
    incrementalTime,
    fullRecalcTime,
    speedup,
    percentImprovement,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(`\n${result.scenario}:`);
  console.log(
    `  Creature: ${result.creature.neurons} neurons, ${result.creature.synapses} synapses`,
  );
  console.log(`  Iterations: ${result.iterations}`);
  console.log(`  Incremental: ${formatDuration(result.incrementalTime)}`);
  console.log(`  Full recalc: ${formatDuration(result.fullRecalcTime)}`);
  console.log(`  Speedup: ${result.speedup.toFixed(2)}x`);
  console.log(`  Improvement: ${result.percentImprovement.toFixed(1)}%`);
}

function runBenchmark() {
  console.log("=".repeat(70));
  console.log("Incremental Score Update Benchmark (Issue #1045)");
  console.log("=".repeat(70));

  const iterations = 1000;
  const warmupIterations = 100;

  // Create test creatures
  const largeCreature = createLargeCreature();
  const veryLargeCreature = createVeryLargeCreature();

  console.log(`\nCreature sizes:`);
  console.log(
    `  Large: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
  );
  console.log(
    `  Very Large: ${veryLargeCreature.neurons.length} neurons, ${veryLargeCreature.synapses.length} synapses`,
  );

  // Warmup
  console.log(`\nWarming up with ${warmupIterations} iterations...`);
  const warmupCreature = createLargeCreature();
  for (let i = 0; i < warmupIterations; i++) {
    calculate(warmupCreature, Math.random() * 0.5, 0.0001);
    warmupCreature.invalidateScoreCache();
  }

  const results: BenchmarkResult[] = [];

  // Benchmark large creature
  console.log("\n--- Large Creature Benchmarks ---");
  results.push(benchmarkWeightMutations(createLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  results.push(benchmarkBiasMutations(createLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  // Benchmark very large creature
  console.log("\n--- Very Large Creature Benchmarks ---");
  results.push(benchmarkWeightMutations(createVeryLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  results.push(benchmarkBiasMutations(createVeryLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("Summary");
  console.log("=".repeat(70));

  const avgSpeedup = results.reduce((sum, r) => sum + r.speedup, 0) /
    results.length;
  const avgImprovement =
    results.reduce((sum, r) => sum + r.percentImprovement, 0) / results.length;

  console.log(
    `\nAverage speedup across all benchmarks: ${avgSpeedup.toFixed(2)}x`,
  );
  console.log(`Average improvement: ${avgImprovement.toFixed(1)}%`);

  // Calculate whether this meets the issue requirement (30-50% faster)
  const meetsTarget = avgImprovement >= 30;
  console.log(
    `\nTarget (30-50% faster): ${meetsTarget ? "✅ MET" : "❌ NOT MET"}`,
  );

  // JSON summary for CI/CD
  const summary = {
    benchmark: "IncrementalScoreUpdate",
    issue: 1045,
    iterations,
    results: results.map((r) => ({
      scenario: r.scenario,
      neurons: r.creature.neurons,
      synapses: r.creature.synapses,
      speedup: r.speedup,
      percentImprovement: r.percentImprovement,
    })),
    averageSpeedup: avgSpeedup,
    averageImprovement: avgImprovement,
    meetsTarget,
  };

  console.log("\nJSON Summary:");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

// Run the benchmark
runBenchmark();
