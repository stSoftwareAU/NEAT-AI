/**
 * Benchmark for Score calculation caching performance.
 * Issue #1011: Cache score calculation components incrementally.
 *
 * This benchmark measures the performance improvement from caching
 * max/avg weight/bias statistics in the score calculation.
 *
 * Usage:
 *   deno run -A bench/ScoreCalculationCache.ts
 */

import { Creature } from "../src/Creature.ts";
import { calculate } from "../src/architecture/Score.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";

function createLargeCreature(): Creature {
  // Create a creature similar to the one mentioned in the issue
  // (619 neurons + 17,935 synapses)
  // We'll create a smaller but still substantial creature for benchmarking
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

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(3)}ms`;
  } else {
    return `${(ms / 1000).toFixed(3)}s`;
  }
}

function runBenchmark() {
  console.log("=".repeat(60));
  console.log("Score Calculation Cache Benchmark (Issue #1011)");
  console.log("=".repeat(60));
  console.log();

  const creature = createLargeCreature();
  console.log(`Creature stats:`);
  console.log(`  Neurons: ${creature.neurons.length}`);
  console.log(`  Synapses: ${creature.synapses.length}`);
  console.log(
    `  Hidden neurons: ${
      creature.neurons.length - creature.input - creature.output
    }`,
  );
  console.log();

  const iterations = 1000;
  const warmupIterations = 100;

  // Warmup
  console.log(`Warming up with ${warmupIterations} iterations...`);
  for (let i = 0; i < warmupIterations; i++) {
    // Clear cache to simulate "uncached" scenario
    creature.invalidateScoreCache();
    calculate(creature, Math.random() * 0.5, 0.0001);
  }

  // Benchmark 1: Uncached scenario (cache cleared before each call)
  console.log(`\nBenchmark 1: Uncached (cache cleared before each call)`);
  const uncachedTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    creature.invalidateScoreCache();
    const start = performance.now();
    calculate(creature, Math.random() * 0.5, 0.0001);
    uncachedTimes.push(performance.now() - start);
  }
  const uncachedAvg = uncachedTimes.reduce((a, b) => a + b, 0) / iterations;
  const uncachedMin = Math.min(...uncachedTimes);
  const uncachedMax = Math.max(...uncachedTimes);
  console.log(`  Iterations: ${iterations}`);
  console.log(`  Average: ${formatDuration(uncachedAvg)}`);
  console.log(`  Min: ${formatDuration(uncachedMin)}`);
  console.log(`  Max: ${formatDuration(uncachedMax)}`);

  // Benchmark 2: Cached scenario (cache reused)
  console.log(`\nBenchmark 2: Cached (cache reused across calls)`);
  // First call populates the cache
  creature.invalidateScoreCache();
  calculate(creature, 0.1, 0.0001);

  const cachedTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    calculate(creature, Math.random() * 0.5, 0.0001);
    cachedTimes.push(performance.now() - start);
  }
  const cachedAvg = cachedTimes.reduce((a, b) => a + b, 0) / iterations;
  const cachedMin = Math.min(...cachedTimes);
  const cachedMax = Math.max(...cachedTimes);
  console.log(`  Iterations: ${iterations}`);
  console.log(`  Average: ${formatDuration(cachedAvg)}`);
  console.log(`  Min: ${formatDuration(cachedMin)}`);
  console.log(`  Max: ${formatDuration(cachedMax)}`);

  // Calculate speedup
  console.log(`\n${"=".repeat(60)}`);
  console.log("Results Summary");
  console.log("=".repeat(60));
  const speedup = uncachedAvg / cachedAvg;
  const percentImprovement = ((uncachedAvg - cachedAvg) / uncachedAvg) * 100;
  console.log(`Speedup: ${speedup.toFixed(2)}x`);
  console.log(`Performance improvement: ${percentImprovement.toFixed(1)}%`);
  console.log();

  // Benchmark 3: Realistic fitness evaluation scenario
  console.log(
    `Benchmark 3: Realistic fitness evaluation (50 creatures, same structure)`,
  );
  const populationSize = 50;
  const creatures: Creature[] = [];

  // Create population with similar structure but different weights
  for (let i = 0; i < populationSize; i++) {
    const c = createLargeCreature();
    creatures.push(c);
  }

  // Each creature gets scored once per generation
  const generations = 20;
  const generationTimes: number[] = [];

  for (let gen = 0; gen < generations; gen++) {
    const genStart = performance.now();
    for (const c of creatures) {
      // Simulate fitness evaluation - creature structure doesn't change
      // between evaluations within a generation
      calculate(c, Math.random() * 0.5, 0.0001);
    }
    generationTimes.push(performance.now() - genStart);
  }

  const avgGenTime = generationTimes.reduce((a, b) => a + b, 0) / generations;
  console.log(`  Population size: ${populationSize}`);
  console.log(`  Generations: ${generations}`);
  console.log(`  Average time per generation: ${formatDuration(avgGenTime)}`);
  console.log(
    `  Average time per creature: ${
      formatDuration(avgGenTime / populationSize)
    }`,
  );
  console.log();

  // Output JSON summary for CI/CD integration
  const summary = {
    creature: {
      neurons: creature.neurons.length,
      synapses: creature.synapses.length,
      hiddenNeurons: creature.neurons.length - creature.input - creature.output,
    },
    uncached: {
      iterations,
      avgMs: uncachedAvg,
      minMs: uncachedMin,
      maxMs: uncachedMax,
    },
    cached: {
      iterations,
      avgMs: cachedAvg,
      minMs: cachedMin,
      maxMs: cachedMax,
    },
    speedup,
    percentImprovement,
    realisticScenario: {
      populationSize,
      generations,
      avgGenerationMs: avgGenTime,
      avgPerCreatureMs: avgGenTime / populationSize,
    },
  };

  console.log("JSON Summary:");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

// Run the benchmark
runBenchmark();
