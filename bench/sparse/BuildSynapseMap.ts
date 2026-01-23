/**
 * Benchmark for buildSynapseMap performance.
 * Issue #1029: Combine two forEach loops into a single pass.
 *
 * This benchmark measures the performance of the chooseNeurons function,
 * which internally uses buildSynapseMap. By running multiple iterations
 * and measuring time, we can verify that the single-pass optimisation
 * provides meaningful improvement.
 *
 * Moved from test/propagate/sparse/BuildSynapseMapBenchmark.ts as part of
 * issue #1181: Benchmarks should NOT be unit tests.
 *
 * Usage:
 *   deno run -A bench/sparse/BuildSynapseMap.ts
 */

import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../src/propagate/sparse/ChooseNeurons.ts";

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
  console.log("=".repeat(70));
  console.log("BuildSynapseMap Benchmark (Issue #1029)");
  console.log("=".repeat(70));

  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 0.05,
  });

  const creatureExport = creature.exportJSON();
  const synapseCount = creatureExport.synapses.length;
  const neuronCount = creatureExport.neurons.length;

  console.log(`\nCreature statistics:`);
  console.log(`  Neurons: ${neuronCount}`);
  console.log(`  Synapses: ${synapseCount}`);

  // Warm-up runs
  console.log(`\nWarming up...`);
  for (let i = 0; i < 10; i++) {
    chooseNeurons(creatureExport, config);
  }

  // Benchmark
  const iterations = 100;
  console.log(`\nRunning ${iterations} iterations...`);

  const startTime = performance.now();
  for (let i = 0; i < iterations; i++) {
    chooseNeurons(creatureExport, config);
  }
  const endTime = performance.now();

  const totalTime = endTime - startTime;
  const avgTime = totalTime / iterations;
  const synapsesPerMs = synapseCount / avgTime;

  console.log(`\n--- Results ---`);
  console.log(`Total time: ${formatDuration(totalTime)}`);
  console.log(`Average time per iteration: ${formatDuration(avgTime)}`);
  console.log(`Synapses per millisecond: ${synapsesPerMs.toFixed(0)}`);

  // JSON summary for CI/CD
  const summary = {
    benchmark: "BuildSynapseMap",
    issue: 1029,
    iterations,
    neuronCount,
    synapseCount,
    totalTimeMs: totalTime,
    avgTimeMs: avgTime,
    synapsesPerMs,
  };

  console.log("\nJSON Summary:");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

// Run the benchmark
runBenchmark();
