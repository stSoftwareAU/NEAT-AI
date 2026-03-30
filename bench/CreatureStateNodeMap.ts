/**
 * Benchmark comparing Map-based nodeMap vs flat array for neuron state access.
 *
 * Issue #1537: Replace CreatureState nodeMap with flat array for O(1) access.
 *
 * Run with:
 *   deno run --allow-hrtime bench/CreatureStateNodeMap.ts
 *
 * Measures:
 * - node() access (get or create)
 * - clear() reset
 * - collectNeuronErrors() iteration
 */

import { Creature } from "../src/Creature.ts";
import { CreatureState } from "@architecture/CreatureState.ts";

const NEURON_COUNTS = [100, 500, 1000];
const ITERATIONS = 5000;

interface BenchResult {
  neuronCount: number;
  nodeAccessMs: number;
  clearMs: number;
  collectErrorsMs: number;
}

function buildCreature(hiddenCount: number): Creature {
  const inputCount = 10;
  const outputCount = 5;

  const neurons: {
    bias: number;
    type: "hidden" | "output";
    squash: string;
    index: number;
  }[] = [];
  const synapses: { weight: number; from: number; to: number }[] = [];

  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      bias: Math.random() - 0.5,
      type: "hidden",
      squash: "LOGISTIC",
      index: inputCount + i,
    });
  }

  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      bias: Math.random() - 0.5,
      type: "output",
      squash: "LOGISTIC",
      index: inputCount + hiddenCount + i,
    });
  }

  for (let i = 0; i < hiddenCount; i++) {
    synapses.push({
      weight: Math.random() - 0.5,
      from: i % inputCount,
      to: inputCount + i,
    });
  }

  for (let i = 0; i < hiddenCount; i++) {
    synapses.push({
      weight: Math.random() - 0.5,
      from: inputCount + i,
      to: inputCount + hiddenCount + (i % outputCount),
    });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: inputCount,
    output: outputCount,
  });
  creature.validate();
  return creature;
}

function benchNodeAccess(creature: Creature, iterations: number): number {
  const neuronCount = creature.neurons.length;
  const start = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    const state = new CreatureState(creature);
    for (let i = 0; i < neuronCount; i++) {
      const ns = state.node(i);
      ns.count += 1;
      ns.totalBias += 0.1;
    }
    // Access again to test retrieval path
    for (let i = 0; i < neuronCount; i++) {
      const ns = state.node(i);
      ns.traceActivation(i * 0.01);
    }
  }
  return performance.now() - start;
}

function benchClear(creature: Creature, iterations: number): number {
  const neuronCount = creature.neurons.length;
  const state = new CreatureState(creature);

  // Populate once
  for (let i = 0; i < neuronCount; i++) {
    const ns = state.node(i);
    ns.count = i;
    ns.totalBias = i * 0.1;
  }

  const start = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    state.clear();
    // Re-populate after clear
    for (let i = 0; i < neuronCount; i++) {
      const ns = state.node(i);
      ns.count = i;
    }
  }
  return performance.now() - start;
}

function benchCollectErrors(creature: Creature, iterations: number): number {
  const neuronCount = creature.neurons.length;
  const state = new CreatureState(creature);

  // Populate with some errors
  for (let i = 0; i < neuronCount; i++) {
    const ns = state.node(i);
    ns.totalErrorAbsolute = i % 3 === 0 ? 0.5 : 0;
  }

  const start = performance.now();
  let totalEntries = 0;
  for (let iter = 0; iter < iterations; iter++) {
    const errors = state.collectNeuronErrors();
    totalEntries += errors.size;
  }
  const elapsed = performance.now() - start;

  // Prevent optimisation
  if (totalEntries < 0) console.log("Unexpected");

  return elapsed;
}

function runBenchmarks(): BenchResult[] {
  const results: BenchResult[] = [];

  for (const hiddenCount of NEURON_COUNTS) {
    console.log(`\nBenchmarking with ~${hiddenCount} hidden neurons...`);
    const creature = buildCreature(hiddenCount);

    const nodeAccessMs = benchNodeAccess(creature, ITERATIONS);
    const clearMs = benchClear(creature, ITERATIONS);
    const collectErrorsMs = benchCollectErrors(creature, ITERATIONS);

    results.push({
      neuronCount: creature.neurons.length,
      nodeAccessMs,
      clearMs,
      collectErrorsMs,
    });
  }

  return results;
}

function printResults(results: BenchResult[]): void {
  console.log("\n========================================");
  console.log("CreatureState nodeMap Benchmark Results");
  console.log("========================================\n");

  console.log(
    "| Neurons | node() access (ms) | clear() (ms) | collectErrors (ms) |",
  );
  console.log(
    "|---------|-------------------|--------------|-------------------|",
  );

  for (const r of results) {
    console.log(
      `| ${r.neuronCount.toString().padStart(7)} | ${
        r.nodeAccessMs.toFixed(2).padStart(17)
      } | ${r.clearMs.toFixed(2).padStart(12)} | ${
        r.collectErrorsMs.toFixed(2).padStart(17)
      } |`,
    );
  }
}

console.log("Starting CreatureState nodeMap benchmark...");
console.log(`Iterations per test: ${ITERATIONS}`);

const results = runBenchmarks();
printResults(results);
