/**
 * Benchmark for path-to-output caching performance.
 * Issue #1294: Path-to-output caching for sparse training.
 *
 * Compares SparseConfig construction with and without a pre-built
 * outgoing synapse map. Also compares calculatePathsToOutput with
 * and without the cached map.
 *
 * Usage:
 *   deno run -A bench/sparse/PathToOutputCache.ts
 */

import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import {
  buildOutgoingSynapsesMap,
  calculatePathsToOutput,
} from "../../src/propagate/sparse/CalculatePathsToOutput.ts";
import { chooseNeurons } from "../../src/propagate/sparse/ChooseNeurons.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

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
  console.log("Path-to-Output Cache Benchmark (Issue #1294)");
  console.log("=".repeat(70));

  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const creatureExport = creature.exportJSON();
  const synapseCount = creatureExport.synapses.length;
  const neuronCount = creatureExport.neurons.length;

  console.log(`\nCreature statistics:`);
  console.log(`  Neurons: ${neuronCount}`);
  console.log(`  Synapses: ${synapseCount}`);

  // ---- Section 1: SparseConfig with vs without cached map ----
  console.log(`\n${"=".repeat(70)}`);
  console.log("SparseConfig construction: uncached vs cached outgoing map");
  console.log("=".repeat(70));

  const sparseRatios = [0.05, 0.1, 0.3, 0.5, 1.0];
  const iterations = 200;

  for (const sparseRatio of sparseRatios) {
    const config = createBackPropagationConfig({ sparseRatio });

    // Warm-up: uncached
    for (let i = 0; i < 5; i++) new SparseConfig(creatureExport, config);

    // Benchmark: uncached
    let start = performance.now();
    for (let i = 0; i < iterations; i++) {
      new SparseConfig(creatureExport, config);
    }
    let end = performance.now();
    const uncachedAvg = (end - start) / iterations;

    // Warm-up: cached
    const cachedMap = buildOutgoingSynapsesMap(creatureExport);
    for (let i = 0; i < 5; i++) {
      new SparseConfig(creatureExport, config, cachedMap);
    }

    // Benchmark: cached
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
      new SparseConfig(creatureExport, config, cachedMap);
    }
    end = performance.now();
    const cachedAvg = (end - start) / iterations;

    const improvement = (uncachedAvg - cachedAvg) / uncachedAvg * 100;

    console.log(`\n  sparseRatio=${sparseRatio}:`);
    console.log(`    Uncached: ${formatDuration(uncachedAvg)}`);
    console.log(`    Cached:   ${formatDuration(cachedAvg)}`);
    console.log(`    Improvement: ${improvement.toFixed(1)}%`);
  }

  // ---- Section 2: calculatePathsToOutput isolated ----
  console.log(`\n${"=".repeat(70)}`);
  console.log("calculatePathsToOutput: uncached vs cached outgoing map");
  console.log("=".repeat(70));

  const config005 = createBackPropagationConfig({ sparseRatio: 0.05 });
  const selectedNeurons = chooseNeurons(creatureExport, config005);
  console.log(`  Selected neurons: ${selectedNeurons.size}`);

  const pathIterations = 1000;

  // Warm-up: uncached
  for (let i = 0; i < 20; i++) {
    calculatePathsToOutput(selectedNeurons, creatureExport);
  }

  // Benchmark: uncached
  let start = performance.now();
  for (let i = 0; i < pathIterations; i++) {
    calculatePathsToOutput(selectedNeurons, creatureExport);
  }
  let end = performance.now();
  const uncachedPathAvg = (end - start) / pathIterations;

  // Warm-up: cached
  const cachedMap = buildOutgoingSynapsesMap(creatureExport);
  for (let i = 0; i < 20; i++) {
    calculatePathsToOutput(selectedNeurons, creatureExport, cachedMap);
  }

  // Benchmark: cached
  start = performance.now();
  for (let i = 0; i < pathIterations; i++) {
    calculatePathsToOutput(selectedNeurons, creatureExport, cachedMap);
  }
  end = performance.now();
  const cachedPathAvg = (end - start) / pathIterations;

  const pathImprovement = (uncachedPathAvg - cachedPathAvg) / uncachedPathAvg *
    100;

  console.log(`\n  calculatePathsToOutput (${pathIterations} iterations):`);
  console.log(`    Uncached: ${formatDuration(uncachedPathAvg)}`);
  console.log(`    Cached:   ${formatDuration(cachedPathAvg)}`);
  console.log(`    Improvement: ${pathImprovement.toFixed(1)}%`);

  // ---- JSON Summary ----
  const summary = {
    benchmark: "PathToOutputCache",
    issue: 1294,
    neuronCount,
    synapseCount,
    sparseConfigImprovements: sparseRatios.map((r) => ({
      sparseRatio: r,
    })),
    calculatePathsUncachedMs: uncachedPathAvg,
    calculatePathsCachedMs: cachedPathAvg,
    calculatePathsImprovementPercent: pathImprovement,
  };

  console.log("\nJSON Summary:");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

runBenchmark();
