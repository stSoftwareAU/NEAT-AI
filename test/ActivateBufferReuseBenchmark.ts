/**
 * Benchmark test for issue #1094: Reuse Float32Array in activate() instead of creating new wrapper
 *
 * This benchmark measures:
 * 1. Activation speed improvement with buffer reuse
 * 2. Memory allocation reduction (via GC pressure proxy metrics)
 * 3. Performance with varying output counts (small, medium, large)
 *
 * Requirements from issue:
 * - Measure 10,000 activation calls on a creature with 100+ outputs
 * - Profile GC activity before/after
 * - Expected improvement: 5-15% for repeated activations
 */
import { assertGreaterOrEqual } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { AddNeuron } from "../src/mutate/AddNeuron.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = false;

/**
 * Creates a creature with the specified number of inputs, outputs, and hidden neurons.
 */
function createCreature(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
): Creature {
  // Create neurons array
  const neurons: {
    type: "hidden" | "output";
    uuid: string;
    bias: number;
    squash: string;
  }[] = [];
  const synapses: { fromUUID: string; toUUID: string; weight: number }[] = [];

  // Add hidden neurons
  for (let i = 0; i < hiddenNeurons; i++) {
    neurons.push({
      type: "hidden",
      uuid: `hidden-${i}`,
      bias: Math.random() * 0.2 - 0.1,
      squash: "LOGISTIC",
    });
    // Connect from input to hidden
    synapses.push({
      fromUUID: `input-${i % inputCount}`,
      toUUID: `hidden-${i}`,
      weight: Math.random() * 2 - 1,
    });
  }

  // Add output neurons
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      bias: Math.random() * 0.2 - 0.1,
      squash: "IDENTITY",
    });
    // Connect from hidden to output (if we have hidden neurons)
    if (hiddenNeurons > 0) {
      synapses.push({
        fromUUID: `hidden-${i % hiddenNeurons}`,
        toUUID: `output-${i}`,
        weight: Math.random() * 2 - 1,
      });
    } else {
      // Connect directly from input to output
      synapses.push({
        fromUUID: `input-${i % inputCount}`,
        toUUID: `output-${i}`,
        weight: Math.random() * 2 - 1,
      });
    }
  }

  return Creature.fromJSON({
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  });
}

/**
 * Creates a large creature similar to production workloads (619+ neurons).
 */
function createLargeCreature(
  inputCount: number,
  outputCount: number,
  targetHiddenNeurons: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);
  const addNeuron = new AddNeuron(creature);

  for (let i = 0; i < targetHiddenNeurons; i++) {
    addNeuron.mutate();
  }

  return creature;
}

interface BenchmarkResult {
  iterations: number;
  reuseBuffer: boolean;
  totalTimeMs: number;
  avgTimePerCallUs: number;
  opsPerSecond: number;
}

/**
 * Runs a benchmark for activate() with the specified settings.
 */
function runBenchmark(
  creature: Creature,
  iterations: number,
  reuseBuffer: boolean,
): BenchmarkResult {
  const input = new Float32Array(creature.input);
  for (let i = 0; i < creature.input; i++) {
    input[i] = Math.random();
  }

  // Warm up - run a few iterations first
  for (let i = 0; i < 100; i++) {
    creature.activate(input, false, reuseBuffer);
  }

  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    creature.activate(input, false, reuseBuffer);
  }

  const endTime = performance.now();
  const totalTimeMs = endTime - startTime;
  const avgTimePerCallUs = (totalTimeMs / iterations) * 1000;
  const opsPerSecond = 1000 / (totalTimeMs / iterations);

  return {
    iterations,
    reuseBuffer,
    totalTimeMs,
    avgTimePerCallUs,
    opsPerSecond,
  };
}

/**
 * Formats a benchmark result for display.
 */
function formatResult(result: BenchmarkResult): string {
  const bufferMode = result.reuseBuffer ? "reuse" : "new  ";
  return `[${bufferMode}] ${result.iterations} iterations: ` +
    `${result.totalTimeMs.toFixed(2)}ms total, ` +
    `${result.avgTimePerCallUs.toFixed(3)}μs/call, ` +
    `${(result.opsPerSecond / 1000).toFixed(1)}K ops/sec`;
}

/**
 * Main benchmark: 10,000 activations on creature with 100+ outputs.
 * This is the benchmark required by issue #1094.
 */
Deno.test("activate(): benchmark - 10,000 calls with 100 outputs", () => {
  const creature = createCreature(10, 100, 50);
  const iterations = 10_000;

  console.log("\n--- Benchmark: 10,000 activations with 100 outputs ---");
  console.log(`Creature: ${creature.input} inputs, ${creature.output} outputs`);
  console.log(
    `Neurons: ${creature.neurons.length}, Synapses: ${creature.synapses.length}`,
  );

  // Benchmark without buffer reuse (baseline)
  const baselineResult = runBenchmark(creature, iterations, false);
  console.log(formatResult(baselineResult));

  // Benchmark with buffer reuse
  const reuseResult = runBenchmark(creature, iterations, true);
  console.log(formatResult(reuseResult));

  // Calculate improvement
  const improvementPct =
    ((baselineResult.totalTimeMs - reuseResult.totalTimeMs) /
      baselineResult.totalTimeMs) *
    100;
  const speedupFactor = baselineResult.totalTimeMs / reuseResult.totalTimeMs;

  console.log(`\nImprovement: ${improvementPct.toFixed(1)}% faster`);
  console.log(`Speedup factor: ${speedupFactor.toFixed(2)}x`);
  console.log("------------------------------------------------------\n");

  // Assert that buffer reuse is at least not slower
  // (actual improvement depends on hardware and GC behaviour)
  assertGreaterOrEqual(
    baselineResult.totalTimeMs,
    reuseResult.totalTimeMs * 0.95, // Allow 5% margin for variance
    "Buffer reuse should not be significantly slower than baseline",
  );
});

/**
 * Benchmark with a large creature (619+ neurons) as mentioned in issue.
 */
Deno.test("activate(): benchmark - large creature (500+ neurons)", () => {
  const creature = createLargeCreature(50, 10, 450);
  const iterations = 10_000;

  console.log("\n--- Benchmark: Large creature (500+ neurons) ---");
  console.log(`Creature: ${creature.input} inputs, ${creature.output} outputs`);
  console.log(
    `Neurons: ${creature.neurons.length}, Synapses: ${creature.synapses.length}`,
  );

  // Benchmark without buffer reuse (baseline)
  const baselineResult = runBenchmark(creature, iterations, false);
  console.log(formatResult(baselineResult));

  // Benchmark with buffer reuse
  const reuseResult = runBenchmark(creature, iterations, true);
  console.log(formatResult(reuseResult));

  // Calculate improvement
  const improvementPct =
    ((baselineResult.totalTimeMs - reuseResult.totalTimeMs) /
      baselineResult.totalTimeMs) *
    100;

  console.log(`\nImprovement: ${improvementPct.toFixed(1)}% faster`);
  console.log("------------------------------------------------------\n");

  // Assert reasonable performance
  // Allow 20% margin for variance - benchmarks on large creatures are susceptible to
  // GC timing, CPU throttling, and other system conditions
  assertGreaterOrEqual(
    baselineResult.totalTimeMs,
    reuseResult.totalTimeMs * 0.80,
    "Buffer reuse should not be significantly slower",
  );
});

/**
 * Benchmark comparing different output counts to show scaling.
 */
Deno.test("activate(): benchmark - output count scaling", () => {
  const iterations = 5_000;
  const outputCounts = [10, 50, 100, 200];

  console.log("\n--- Benchmark: Output count scaling ---");
  console.log(`Iterations per test: ${iterations}`);
  console.log("");

  const results: {
    outputs: number;
    baseline: number;
    reuse: number;
    improvement: number;
  }[] = [];

  for (const outputs of outputCounts) {
    const creature = createCreature(10, outputs, 20);

    const baselineResult = runBenchmark(creature, iterations, false);
    const reuseResult = runBenchmark(creature, iterations, true);

    const improvementPct =
      ((baselineResult.totalTimeMs - reuseResult.totalTimeMs) /
        baselineResult.totalTimeMs) *
      100;

    results.push({
      outputs,
      baseline: baselineResult.avgTimePerCallUs,
      reuse: reuseResult.avgTimePerCallUs,
      improvement: improvementPct,
    });

    console.log(
      `${outputs} outputs: baseline=${
        baselineResult.avgTimePerCallUs.toFixed(2)
      }μs, ` +
        `reuse=${reuseResult.avgTimePerCallUs.toFixed(2)}μs, ` +
        `improvement=${improvementPct.toFixed(1)}%`,
    );
  }

  console.log("------------------------------------------------------\n");
});

/**
 * Benchmark measuring memory allocation patterns.
 * This is a proxy for GC pressure - more allocations means more GC work.
 */
Deno.test("activate(): benchmark - memory allocation stress test", () => {
  const inputCount = 10;
  const creature = createCreature(inputCount, 100, 50);
  const iterations = 50_000;

  console.log("\n--- Benchmark: Memory allocation stress test ---");
  console.log(`Running ${iterations} iterations to stress allocator`);

  // Create a properly sized input array
  const input = new Float32Array(inputCount);
  for (let i = 0; i < inputCount; i++) {
    input[i] = Math.random();
  }

  // Force GC if available
  const globalWithGC = globalThis as unknown as { gc?: () => void };
  if (typeof globalWithGC.gc === "function") {
    globalWithGC.gc();
  }

  // Baseline - creates new arrays (more allocations)
  const baselineStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    creature.activate(input, false, false);
  }
  const baselineTime = performance.now() - baselineStart;

  // Force GC again
  if (typeof globalWithGC.gc === "function") {
    globalWithGC.gc();
  }

  // With buffer reuse - fewer allocations
  const reuseStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    creature.activate(input, false, true);
  }
  const reuseTime = performance.now() - reuseStart;

  const improvementPct = ((baselineTime - reuseTime) / baselineTime) * 100;

  console.log(`Baseline (new arrays): ${baselineTime.toFixed(2)}ms`);
  console.log(`With buffer reuse:     ${reuseTime.toFixed(2)}ms`);
  console.log(`Improvement: ${improvementPct.toFixed(1)}%`);
  console.log("------------------------------------------------------\n");

  // The buffer reuse should show improvement due to reduced allocations
  // Allow 30% margin for variance - stress tests are susceptible to GC timing,
  // CPU throttling, cache effects, and other system conditions
  assertGreaterOrEqual(
    baselineTime,
    reuseTime * 0.7,
    "Buffer reuse should reduce allocation overhead",
  );
});

/**
 * Benchmark simulating fitness evaluation loop.
 * This simulates the actual use case from issue #1094.
 */
Deno.test("activate(): benchmark - fitness evaluation simulation", () => {
  // Simulate population of 100 creatures, each activated multiple times
  const populationSize = 100;
  const activationsPerCreature = 100;
  const outputCount = 50;

  console.log("\n--- Benchmark: Fitness evaluation simulation ---");
  console.log(`Population: ${populationSize} creatures`);
  console.log(`Activations per creature: ${activationsPerCreature}`);
  console.log(`Total activations: ${populationSize * activationsPerCreature}`);

  // Create a single creature for this test (in real scenarios, each creature differs)
  const creature = createCreature(10, outputCount, 30);

  const input = new Float32Array(10);
  for (let i = 0; i < 10; i++) {
    input[i] = Math.random();
  }

  // Baseline - simulating fitness evaluation without buffer reuse
  const baselineStart = performance.now();
  for (let p = 0; p < populationSize; p++) {
    for (let a = 0; a < activationsPerCreature; a++) {
      creature.activate(input, false, false);
    }
  }
  const baselineTime = performance.now() - baselineStart;

  // With buffer reuse
  const reuseStart = performance.now();
  for (let p = 0; p < populationSize; p++) {
    for (let a = 0; a < activationsPerCreature; a++) {
      creature.activate(input, false, true);
    }
  }
  const reuseTime = performance.now() - reuseStart;

  const improvementPct = ((baselineTime - reuseTime) / baselineTime) * 100;
  const totalActivations = populationSize * activationsPerCreature;

  console.log(
    `Baseline: ${baselineTime.toFixed(2)}ms (${
      (baselineTime / totalActivations * 1000).toFixed(2)
    }μs/call)`,
  );
  console.log(
    `With reuse: ${reuseTime.toFixed(2)}ms (${
      (reuseTime / totalActivations * 1000).toFixed(2)
    }μs/call)`,
  );
  console.log(`Improvement: ${improvementPct.toFixed(1)}%`);
  console.log("------------------------------------------------------\n");

  // Assert reasonable performance improvement
  assertGreaterOrEqual(
    baselineTime,
    reuseTime * 0.9,
    "Buffer reuse should not significantly slow down fitness evaluation",
  );
});
