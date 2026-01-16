/**
 * Benchmark comparing DenseNumberMap (TypedArray-based) vs Map<number, number>
 * for dense neuron state storage.
 *
 * Issue #1041: Use TypedArray for dense neuron state storage.
 *
 * Run with:
 *   deno run bench/DenseNumberMapBenchmark.ts
 *
 * Expected results:
 * - DenseNumberMap should be faster for set/get/has operations on dense indices
 * - Better cache locality with TypedArrays due to contiguous memory layout
 */

import { DenseNumberMap } from "../src/architecture/DenseNumberMap.ts";

const NEURON_COUNTS = [100, 1000, 10000];
const ITERATIONS = 10000;

interface BenchmarkResult {
  neuronCount: number;
  mapSetMs: number;
  denseSetMs: number;
  mapGetMs: number;
  denseGetMs: number;
  mapHasMs: number;
  denseHasMs: number;
  mapClearMs: number;
  denseClearMs: number;
}

function benchmarkSet(
  map: Map<number, number> | DenseNumberMap,
  neuronCount: number,
  iterations: number,
): number {
  const start = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < neuronCount; i++) {
      map.set(i, Math.random());
    }
    map.clear();
  }
  return performance.now() - start;
}

function benchmarkGet(
  map: Map<number, number> | DenseNumberMap,
  neuronCount: number,
  iterations: number,
): number {
  // Prefill the map
  for (let i = 0; i < neuronCount; i++) {
    map.set(i, Math.random());
  }

  const start = performance.now();
  let sum = 0;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < neuronCount; i++) {
      sum += map.get(i) ?? 0;
    }
  }
  const elapsed = performance.now() - start;

  // Use sum to prevent optimisation
  if (sum < 0) console.log("Unexpected negative sum");

  return elapsed;
}

function benchmarkHas(
  map: Map<number, number> | DenseNumberMap,
  neuronCount: number,
  iterations: number,
): number {
  // Prefill half the map
  for (let i = 0; i < neuronCount; i += 2) {
    map.set(i, Math.random());
  }

  const start = performance.now();
  let count = 0;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < neuronCount; i++) {
      if (map.has(i)) count++;
    }
  }
  const elapsed = performance.now() - start;

  // Use count to prevent optimisation
  if (count < 0) console.log("Unexpected negative count");

  return elapsed;
}

function benchmarkClear(
  map: Map<number, number> | DenseNumberMap,
  neuronCount: number,
  iterations: number,
): number {
  const start = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    // Fill and clear
    for (let i = 0; i < neuronCount; i++) {
      map.set(i, Math.random());
    }
    map.clear();
  }
  return performance.now() - start;
}

function runBenchmarks(): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  for (const neuronCount of NEURON_COUNTS) {
    console.log(`\nBenchmarking with ${neuronCount} neurons...`);

    // Create fresh instances for each benchmark
    const mapForSet = new Map<number, number>();
    const denseForSet = new DenseNumberMap(neuronCount);

    const mapForGet = new Map<number, number>();
    const denseForGet = new DenseNumberMap(neuronCount);

    const mapForHas = new Map<number, number>();
    const denseForHas = new DenseNumberMap(neuronCount);

    const mapForClear = new Map<number, number>();
    const denseForClear = new DenseNumberMap(neuronCount);

    // Run benchmarks
    const mapSetMs = benchmarkSet(mapForSet, neuronCount, ITERATIONS);
    const denseSetMs = benchmarkSet(denseForSet, neuronCount, ITERATIONS);

    const mapGetMs = benchmarkGet(mapForGet, neuronCount, ITERATIONS);
    const denseGetMs = benchmarkGet(denseForGet, neuronCount, ITERATIONS);

    const mapHasMs = benchmarkHas(mapForHas, neuronCount, ITERATIONS);
    const denseHasMs = benchmarkHas(denseForHas, neuronCount, ITERATIONS);

    const mapClearMs = benchmarkClear(mapForClear, neuronCount, ITERATIONS);
    const denseClearMs = benchmarkClear(denseForClear, neuronCount, ITERATIONS);

    results.push({
      neuronCount,
      mapSetMs,
      denseSetMs,
      mapGetMs,
      denseGetMs,
      mapHasMs,
      denseHasMs,
      mapClearMs,
      denseClearMs,
    });
  }

  return results;
}

function printResults(results: BenchmarkResult[]): void {
  console.log("\n========================================");
  console.log("DenseNumberMap vs Map<number, number> Benchmark Results");
  console.log("========================================\n");

  console.log(
    "| Neurons | Operation | Map (ms) | DenseNumberMap (ms) | Speedup |",
  );
  console.log(
    "|---------|-----------|----------|---------------------|---------|",
  );

  for (const result of results) {
    const setSpeedup = (result.mapSetMs / result.denseSetMs).toFixed(2);
    const getSpeedup = (result.mapGetMs / result.denseGetMs).toFixed(2);
    const hasSpeedup = (result.mapHasMs / result.denseHasMs).toFixed(2);
    const clearSpeedup = (result.mapClearMs / result.denseClearMs).toFixed(2);

    console.log(
      `| ${result.neuronCount.toString().padStart(7)} | set       | ${
        result.mapSetMs.toFixed(2).padStart(8)
      } | ${result.denseSetMs.toFixed(2).padStart(19)} | ${
        setSpeedup.padStart(7)
      }x |`,
    );
    console.log(
      `| ${" ".repeat(7)} | get       | ${
        result.mapGetMs.toFixed(2).padStart(8)
      } | ${result.denseGetMs.toFixed(2).padStart(19)} | ${
        getSpeedup.padStart(7)
      }x |`,
    );
    console.log(
      `| ${" ".repeat(7)} | has       | ${
        result.mapHasMs.toFixed(2).padStart(8)
      } | ${result.denseHasMs.toFixed(2).padStart(19)} | ${
        hasSpeedup.padStart(7)
      }x |`,
    );
    console.log(
      `| ${" ".repeat(7)} | clear     | ${
        result.mapClearMs.toFixed(2).padStart(8)
      } | ${result.denseClearMs.toFixed(2).padStart(19)} | ${
        clearSpeedup.padStart(7)
      }x |`,
    );
  }

  console.log("\nNote: Speedup > 1.0 means DenseNumberMap is faster");
}

// Main execution
console.log("Starting DenseNumberMap benchmark...");
console.log(`Iterations per test: ${ITERATIONS}`);

const results = runBenchmarks();
printResults(results);
