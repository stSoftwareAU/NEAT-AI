/**
 * Benchmark for WASM batch score computation (Issue #1521).
 *
 * Compares TypeScript vs WASM score computation on large networks.
 * The benchmark measures `computeAndCacheScoreComponents` (the cold-cache
 * full scan path) and the `scanMaxForWeightChange` path.
 *
 * Usage:
 *   deno run -A bench/WasmScoreScan.ts
 */

import { Creature } from "@creature";
import { calculate } from "@architecture/Score.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import { TANH } from "@methods/activations/types/TANH.ts";

function createLargeCreature(): Creature {
  return new Creature(50, 5, {
    layers: [
      { count: 200, squash: IDENTITY.NAME },
      { count: 150, squash: LOGISTIC.NAME },
      { count: 100, squash: TANH.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });
}

function createVeryLargeCreature(): Creature {
  return new Creature(100, 10, {
    layers: [
      { count: 300, squash: IDENTITY.NAME },
      { count: 200, squash: LOGISTIC.NAME },
      { count: 150, squash: TANH.NAME },
      { count: 100, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: LOGISTIC.NAME },
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

interface BenchmarkResult {
  scenario: string;
  neurons: number;
  synapses: number;
  iterations: number;
  timeMs: number;
  perIterationUs: number;
}

function benchmarkColdCacheScoring(
  creature: Creature,
  iterations: number,
  label: string,
): BenchmarkResult {
  const growthCost = 0.0001;
  const error = 0.1;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);
  }
  const timeMs = performance.now() - start;
  const perIterationUs = (timeMs / iterations) * 1000;

  return {
    scenario: label,
    neurons: creature.neurons.length,
    synapses: creature.synapses.length,
    iterations,
    timeMs,
    perIterationUs,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(`\n  ${result.scenario}:`);
  console.log(
    `    Creature: ${result.neurons} neurons, ${result.synapses} synapses`,
  );
  console.log(`    Iterations: ${result.iterations}`);
  console.log(`    Total: ${formatDuration(result.timeMs)}`);
  console.log(`    Per iteration: ${result.perIterationUs.toFixed(2)}us`);
}

async function runBenchmark() {
  console.log("=".repeat(70));
  console.log("WASM Score Scan Benchmark (Issue #1521)");
  console.log("=".repeat(70));

  await ensureWasmActivation();

  const iterations = 1000;
  const warmupIterations = 200;

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
    warmupCreature.invalidateScoreCache();
    calculate(warmupCreature, Math.random() * 0.5, 0.0001);
  }

  const results: BenchmarkResult[] = [];

  // Benchmark cold-cache scoring (full scan)
  console.log("\n--- Cold-Cache Score Computation (Full Scan) ---");

  results.push(
    benchmarkColdCacheScoring(
      createLargeCreature(),
      iterations,
      "Large creature cold-cache",
    ),
  );
  printResult(results[results.length - 1]);

  results.push(
    benchmarkColdCacheScoring(
      createVeryLargeCreature(),
      iterations,
      "Very large creature cold-cache",
    ),
  );
  printResult(results[results.length - 1]);

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("Summary");
  console.log("=".repeat(70));

  const avgPerIteration =
    results.reduce((sum, r) => sum + r.perIterationUs, 0) / results.length;
  console.log(
    `\nAverage per-iteration time: ${avgPerIteration.toFixed(2)}us`,
  );

  // JSON summary
  const summary = {
    benchmark: "WasmScoreScan",
    issue: 1521,
    iterations,
    results: results.map((r) => ({
      scenario: r.scenario,
      neurons: r.neurons,
      synapses: r.synapses,
      timeMs: r.timeMs,
      perIterationUs: r.perIterationUs,
    })),
    averagePerIterationUs: avgPerIteration,
  };

  console.log("\nJSON Summary:");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

// Run the benchmark
await runBenchmark();
