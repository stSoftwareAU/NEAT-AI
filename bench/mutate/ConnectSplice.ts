/**
 * Benchmark for issue #1093: Use splice() instead of slice/spread in connect() method
 *
 * This benchmark measures the performance improvement from using splice()
 * instead of slice/spread for inserting synapses in sorted order.
 *
 * Moved from test/mutate/ConnectSpliceBenchmark.ts as part of
 * issue #1181: Benchmarks should NOT be unit tests.
 *
 * Usage:
 *   deno run -A bench/mutate/ConnectSplice.ts
 */

import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(3)}ms`;
  } else {
    return `${(ms / 1000).toFixed(3)}s`;
  }
}

/**
 * Helper to create a large creature for benchmarking.
 * Creates a creature with many neurons and synapses to simulate production workloads.
 */
function createLargeCreature(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);
  const addNeuron = new AddNeuron(creature);

  for (let i = 0; i < hiddenNeurons; i++) {
    addNeuron.mutate();
  }

  return creature;
}

/**
 * Verifies that synapses are correctly ordered after connect() operations.
 * Synapses should be sorted by (from, to) pairs.
 */
function verifySynapseOrdering(creature: Creature): boolean {
  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];

    // Sort order: first by 'from', then by 'to'
    const isOrdered = prev.from < curr.from ||
      (prev.from === curr.from && prev.to < curr.to);

    if (!isOrdered) {
      console.error(
        `Synapses out of order at index ${i}: ` +
          `[${prev.from}->${prev.to}] should come before [${curr.from}->${curr.to}]`,
      );
      return false;
    }
  }
  return true;
}

interface BenchmarkResult {
  scenario: string;
  inputCount: number;
  outputCount: number;
  hiddenNeurons: number;
  initialSynapses: number;
  connectionsAdded: number;
  finalSynapses: number;
  totalTimeMs: number;
  avgPerConnectMs: number;
  operationsPerSecond: number;
  orderingValid: boolean;
  creatureValid: boolean;
}

function benchmarkConnectCalls(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
  connectionsToAdd: number,
): BenchmarkResult {
  const creature = createLargeCreature(inputCount, outputCount, hiddenNeurons);
  const initialSynapses = creature.synapses.length;

  // Get available connection slots
  const available = creature.getAvailableConnections();
  const actualConnectionsToAdd = Math.min(connectionsToAdd, available.length);

  // Benchmark the connect() calls
  const startTime = performance.now();

  for (let i = 0; i < actualConnectionsToAdd; i++) {
    const [from, to] = available[i];
    creature.connect(from, to, Math.random() * 2 - 1);
  }

  const endTime = performance.now();
  const totalTimeMs = endTime - startTime;
  const avgPerConnectMs = totalTimeMs / actualConnectionsToAdd;

  // Verify ordering is maintained
  const orderingValid = verifySynapseOrdering(creature);

  // Validate the creature
  let creatureValid = true;
  try {
    creatureValidate(creature);
  } catch {
    creatureValid = false;
  }

  return {
    scenario: `${inputCount}in/${outputCount}out/${hiddenNeurons}hidden`,
    inputCount,
    outputCount,
    hiddenNeurons,
    initialSynapses,
    connectionsAdded: actualConnectionsToAdd,
    finalSynapses: creature.synapses.length,
    totalTimeMs,
    avgPerConnectMs,
    operationsPerSecond: 1000 / avgPerConnectMs,
    orderingValid,
    creatureValid,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(`\n${result.scenario}:`);
  console.log(`  Initial synapses: ${result.initialSynapses}`);
  console.log(`  Connections added: ${result.connectionsAdded}`);
  console.log(`  Final synapses: ${result.finalSynapses}`);
  console.log(`  Total time: ${formatDuration(result.totalTimeMs)}`);
  console.log(`  Avg per connect(): ${formatDuration(result.avgPerConnectMs)}`);
  console.log(
    `  Operations/second: ${result.operationsPerSecond.toFixed(0)}`,
  );
  console.log(`  Ordering valid: ${result.orderingValid ? "✅" : "❌"}`);
  console.log(`  Creature valid: ${result.creatureValid ? "✅" : "❌"}`);
}

function runBenchmark() {
  console.log("=".repeat(70));
  console.log("Connect() Splice Benchmark (Issue #1093)");
  console.log("=".repeat(70));

  const results: BenchmarkResult[] = [];

  // Warmup
  console.log("\nWarming up...");
  benchmarkConnectCalls(10, 5, 20, 50);

  // Small creature
  console.log("\n--- Small Creature ---");
  results.push(benchmarkConnectCalls(10, 5, 50, 200));
  printResult(results[results.length - 1]);

  // Medium creature
  console.log("\n--- Medium Creature ---");
  results.push(benchmarkConnectCalls(30, 10, 100, 500));
  printResult(results[results.length - 1]);

  // Large creature
  console.log("\n--- Large Creature ---");
  results.push(benchmarkConnectCalls(50, 10, 200, 1000));
  printResult(results[results.length - 1]);

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("Summary");
  console.log("=".repeat(70));

  const avgOpsPerSec = results.reduce(
    (sum, r) => sum + r.operationsPerSecond,
    0,
  ) / results.length;
  const allValid = results.every((r) => r.orderingValid && r.creatureValid);

  console.log(`\nAverage operations/second: ${avgOpsPerSec.toFixed(0)}`);
  console.log(`All validations passed: ${allValid ? "✅" : "❌"}`);

  // JSON summary for CI/CD
  const summary = {
    benchmark: "ConnectSplice",
    issue: 1093,
    results: results.map((r) => ({
      scenario: r.scenario,
      connectionsAdded: r.connectionsAdded,
      totalTimeMs: r.totalTimeMs,
      avgPerConnectMs: r.avgPerConnectMs,
      operationsPerSecond: r.operationsPerSecond,
      valid: r.orderingValid && r.creatureValid,
    })),
    averageOpsPerSecond: avgOpsPerSec,
    allValid,
  };

  console.log("\nJSON Summary:");
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

// Run the benchmark
runBenchmark();
