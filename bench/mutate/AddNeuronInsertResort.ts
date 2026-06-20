/**
 * Benchmark for issue #3083: Remove redundant full synapse re-sort in
 * AddNeuron.insertNeuron.
 *
 * insertNeuron remaps every synapse coordinate >= the insertion index, then
 * (previously) re-sorted the entire synapse array. The remap is strictly
 * monotonic, so it preserves the existing (from, to) ordering — the sort was
 * redundant O(E log E) work on a per-genome, per-generation hot path.
 *
 * This benchmark builds a large, dense creature and times many ADD_NODE
 * mutations so the saving (and any regression) is visible. It also verifies
 * the synapse ordering invariant still holds after every mutation.
 *
 * Usage:
 *   deno run -A bench/mutate/AddNeuronInsertResort.ts
 */

import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { AddConnection } from "@mutate/AddConnection.ts";

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  if (ms < 1000) return `${ms.toFixed(3)}ms`;
  return `${(ms / 1000).toFixed(3)}s`;
}

/** Build a creature with many neurons and a dense synapse set. */
function createDenseCreature(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
  extraConnections: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);
  const addNeuron = new AddNeuron(creature);
  for (let i = 0; i < hiddenNeurons; i++) {
    addNeuron.mutate();
  }
  // Densify with extra connections so E (synapse count) is large.
  const addConnection = new AddConnection(creature);
  for (let i = 0; i < extraConnections; i++) {
    addConnection.mutate();
  }
  return creature;
}

/** Synapses must stay sorted by (from, to). */
function verifySynapseOrdering(creature: Creature): boolean {
  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];
    const ordered = prev.from < curr.from ||
      (prev.from === curr.from && prev.to < curr.to);
    if (!ordered) return false;
  }
  return true;
}

interface BenchResult {
  scenario: string;
  synapsesAtStart: number;
  synapsesAtEnd: number;
  mutations: number;
  totalTimeMs: number;
  avgPerMutationMs: number;
  orderingValid: boolean;
  creatureValid: boolean;
}

function benchmark(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
  extraConnections: number,
  mutations: number,
): BenchResult {
  const creature = createDenseCreature(
    inputCount,
    outputCount,
    hiddenNeurons,
    extraConnections,
  );
  const synapsesAtStart = creature.synapses.length;
  const addNeuron = new AddNeuron(creature);

  let orderingValid = true;
  const start = performance.now();
  for (let i = 0; i < mutations; i++) {
    addNeuron.mutate();
    if (!verifySynapseOrdering(creature)) orderingValid = false;
  }
  const totalTimeMs = performance.now() - start;

  let creatureValid = true;
  try {
    creatureValidate(creature);
  } catch {
    creatureValid = false;
  }

  return {
    scenario: `${inputCount}in/${outputCount}out/${hiddenNeurons}hidden`,
    synapsesAtStart,
    synapsesAtEnd: creature.synapses.length,
    mutations,
    totalTimeMs,
    avgPerMutationMs: totalTimeMs / mutations,
    orderingValid,
    creatureValid,
  };
}

function printResult(r: BenchResult): void {
  console.log(`\n${r.scenario}:`);
  console.log(`  Synapses at start: ${r.synapsesAtStart}`);
  console.log(`  Synapses at end:   ${r.synapsesAtEnd}`);
  console.log(`  ADD_NODE mutations: ${r.mutations}`);
  console.log(`  Total time: ${formatDuration(r.totalTimeMs)}`);
  console.log(`  Avg per mutation: ${formatDuration(r.avgPerMutationMs)}`);
  console.log(`  Ordering valid: ${r.orderingValid ? "✅" : "❌"}`);
  console.log(`  Creature valid: ${r.creatureValid ? "✅" : "❌"}`);
}

function run() {
  console.log("=".repeat(70));
  console.log("AddNeuron insertNeuron re-sort benchmark (Issue #3083)");
  console.log("=".repeat(70));

  // Warmup
  benchmark(10, 5, 30, 100, 50);

  const results: BenchResult[] = [];
  results.push(benchmark(20, 5, 100, 400, 200));
  printResult(results[results.length - 1]);
  results.push(benchmark(40, 10, 200, 1200, 300));
  printResult(results[results.length - 1]);

  const allValid = results.every((r) => r.orderingValid && r.creatureValid);
  console.log("\n" + "=".repeat(70));
  console.log(`All validations passed: ${allValid ? "✅" : "❌"}`);

  const summary = {
    benchmark: "AddNeuronInsertResort",
    issue: 3083,
    results: results.map((r) => ({
      scenario: r.scenario,
      synapsesAtEnd: r.synapsesAtEnd,
      mutations: r.mutations,
      totalTimeMs: r.totalTimeMs,
      avgPerMutationMs: r.avgPerMutationMs,
      valid: r.orderingValid && r.creatureValid,
    })),
    allValid,
  };
  console.log("\nJSON Summary:");
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

run();
