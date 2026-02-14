/**
 * Benchmark for max weight/bias recalculation performance.
 * Issue #1442: Optimise max weight/bias recalculation in Score.ts.
 *
 * This benchmark measures the performance of the runner-up max (secondMax)
 * optimisation. When the current maximum weight/bias is reduced, the
 * secondMax enables O(1) max recovery instead of an O(n) full scan.
 *
 * Usage:
 *   deno run -A bench/MaxWeightBiasRecalculation.ts
 */

import { Creature } from "../src/Creature.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "../src/architecture/Score.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";

function createLargeCreature(): Creature {
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
  totalTime: number;
  avgTime: number;
}

/**
 * Benchmark: max weight is reduced, triggering the max recalculation path.
 *
 * Each iteration:
 * 1. Sets a synapse to be the max (high value)
 * 2. Populates the cache
 * 3. Reduces that max synapse, triggering max recalculation
 *
 * The secondMax optimisation avoids a full scan on every other reduction.
 */
function benchmarkMaxRecalcWeight(
  creature: Creature,
  iterations: number,
): BenchmarkResult {
  const growthCost = 0.0001;
  const error = 0.1;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Reset: set synapse 0 to a high value and rebuild cache
    creature.synapses[0].weight = 100 + i;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);

    // Now reduce the max weight, triggering max recalculation
    const synapse = creature.synapses[0];
    const oldWeight = synapse.weight;
    const newWeight = 0.1;
    synapse.weight = newWeight;
    updateScoreForWeightChange(
      creature,
      error,
      growthCost,
      oldWeight,
      newWeight,
    );
  }
  const totalTime = performance.now() - start;

  return {
    scenario: "Weight max recalculation (with secondMax)",
    creature: {
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      hiddenNeurons: creature.neurons.length - creature.input - creature.output,
    },
    iterations,
    totalTime,
    avgTime: totalTime / iterations,
  };
}

/**
 * Benchmark: repeated max reductions that alternate between
 * secondMax fast path and full scan fallback.
 *
 * This measures the real-world scenario where multiple consecutive
 * max reductions occur.
 */
function benchmarkRepeatedMaxReductions(
  creature: Creature,
  iterations: number,
): BenchmarkResult {
  const growthCost = 0.0001;
  const error = 0.1;

  // Set up a clear hierarchy of weights
  creature.synapses[0].weight = 100;
  creature.synapses[1].weight = 90;
  creature.synapses[2].weight = 80;
  creature.invalidateScoreCache();
  calculate(creature, error, growthCost);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Reduce the current max, triggering secondMax path or full scan
    const cached = creature.cachedScoreComponents!;
    const maxVal = cached.maxWeightBias;

    // Find a synapse with the max value and reduce it
    for (let j = 0; j < creature.synapses.length; j++) {
      if (Math.abs(creature.synapses[j].weight) === maxVal) {
        const oldWeight = creature.synapses[j].weight;
        const newWeight = 0.01;
        creature.synapses[j].weight = newWeight;
        updateScoreForWeightChange(
          creature,
          error,
          growthCost,
          oldWeight,
          newWeight,
        );
        break;
      }
    }

    // Restore: set synapse 0 back to max for next iteration
    const oldW = creature.synapses[0].weight;
    const newW = 100 + i;
    creature.synapses[0].weight = newW;
    updateScoreForWeightChange(creature, error, growthCost, oldW, newW);
  }
  const totalTime = performance.now() - start;

  return {
    scenario: "Repeated max reductions (alternating fast/scan paths)",
    creature: {
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      hiddenNeurons: creature.neurons.length - creature.input - creature.output,
    },
    iterations,
    totalTime,
    avgTime: totalTime / iterations,
  };
}

/**
 * Benchmark: max bias reduction.
 */
function benchmarkMaxRecalcBias(
  creature: Creature,
  iterations: number,
): BenchmarkResult {
  const growthCost = 0.0001;
  const error = 0.1;
  const targetNeuronIdx = creature.input;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Reset: set bias to a high value and rebuild cache
    creature.neurons[targetNeuronIdx].bias = 100 + i;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);

    // Reduce the max bias, triggering max recalculation
    const neuron = creature.neurons[targetNeuronIdx];
    const oldBias = neuron.bias;
    const newBias = 0.1;
    neuron.bias = newBias;
    updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);
  }
  const totalTime = performance.now() - start;

  return {
    scenario: "Bias max recalculation (with secondMax)",
    creature: {
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      hiddenNeurons: creature.neurons.length - creature.input - creature.output,
    },
    iterations,
    totalTime,
    avgTime: totalTime / iterations,
  };
}

/**
 * Benchmark a mixed scenario with some max-reducing mutations.
 */
function benchmarkMixedMutations(
  creature: Creature,
  iterations: number,
): BenchmarkResult {
  const growthCost = 0.0001;
  const error = 0.1;

  // Set up with a clear max
  creature.synapses[0].weight = 100;
  creature.invalidateScoreCache();
  calculate(creature, error, growthCost);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    if (i % 5 === 0) {
      // Every 5th iteration: reduce the max (triggers secondMax path)
      const synapse = creature.synapses[0];
      const oldWeight = synapse.weight;
      const newWeight = 0.1;
      synapse.weight = newWeight;
      updateScoreForWeightChange(
        creature,
        error,
        growthCost,
        oldWeight,
        newWeight,
      );

      // Restore for next time
      const oldW2 = synapse.weight;
      synapse.weight = 100;
      updateScoreForWeightChange(creature, error, growthCost, oldW2, 100);
    } else {
      // Normal mutations (fast path - no max change)
      const idx = (i % (creature.synapses.length - 1)) + 1;
      const synapse = creature.synapses[idx];
      const oldWeight = synapse.weight;
      const newWeight = oldWeight + (Math.random() - 0.5) * 0.2;
      synapse.weight = newWeight;
      updateScoreForWeightChange(
        creature,
        error,
        growthCost,
        oldWeight,
        newWeight,
      );
    }
  }
  const totalTime = performance.now() - start;

  return {
    scenario: "Mixed mutations (~20% max-reducing)",
    creature: {
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      hiddenNeurons: creature.neurons.length - creature.input - creature.output,
    },
    iterations,
    totalTime,
    avgTime: totalTime / iterations,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(`\n${result.scenario}:`);
  console.log(
    `  Creature: ${result.creature.neurons} neurons, ${result.creature.synapses} synapses`,
  );
  console.log(`  Iterations: ${result.iterations}`);
  console.log(`  Total time: ${formatDuration(result.totalTime)}`);
  console.log(`  Average per iteration: ${formatDuration(result.avgTime)}`);
}

function runBenchmark() {
  console.log("=".repeat(70));
  console.log("Max Weight/Bias Recalculation Benchmark (Issue #1442)");
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

  // Large creature benchmarks
  console.log("\n--- Large Creature Benchmarks ---");
  results.push(benchmarkMaxRecalcWeight(createLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  results.push(
    benchmarkRepeatedMaxReductions(createLargeCreature(), iterations),
  );
  printResult(results[results.length - 1]);

  results.push(benchmarkMaxRecalcBias(createLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  results.push(benchmarkMixedMutations(createLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  // Very large creature benchmarks
  console.log("\n--- Very Large Creature Benchmarks ---");
  results.push(
    benchmarkMaxRecalcWeight(createVeryLargeCreature(), iterations),
  );
  printResult(results[results.length - 1]);

  results.push(
    benchmarkRepeatedMaxReductions(createVeryLargeCreature(), iterations),
  );
  printResult(results[results.length - 1]);

  results.push(benchmarkMaxRecalcBias(createVeryLargeCreature(), iterations));
  printResult(results[results.length - 1]);

  results.push(
    benchmarkMixedMutations(createVeryLargeCreature(), iterations),
  );
  printResult(results[results.length - 1]);

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("Summary");
  console.log("=".repeat(70));

  // JSON summary
  const summary = {
    benchmark: "MaxWeightBiasRecalculation",
    issue: 1442,
    iterations,
    results: results.map((r) => ({
      scenario: r.scenario,
      neurons: r.creature.neurons,
      synapses: r.creature.synapses,
      totalTimeMs: r.totalTime,
      avgTimeMs: r.avgTime,
    })),
  };

  console.log("\nJSON Summary:");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

// Run the benchmark
runBenchmark();
