/**
 * Benchmark: inwardList.slice().sort() elimination (Issue #1536)
 *
 * Measures the overhead of the redundant .slice().sort() calls that were
 * previously used in the WASM trace path. Since inwardConnections() already
 * returns results sorted by `from`, the sort is unnecessary.
 *
 * Run with: deno bench --allow-read bench/InwardSliceSortElimination.ts
 */
import { Creature } from "../src/Creature.ts";
import type { Synapse } from "../src/architecture/Synapse.ts";

const creatureFile = Deno.args[0] || "test/data/traced.json";
const creature = Creature.fromJSON(
  JSON.parse(
    Deno.readTextFileSync(creatureFile),
  ),
);
creature.fix();

// Prebuild the index so lookups are fast (isolates the sort overhead)
creature.prebuildInwardIndex();

const numNeurons = creature.neurons.length;
const numInputs = creature.input;

console.log(
  `Creature: ${numNeurons} neurons, ${creature.synapses.length} synapses`,
);

/**
 * Baseline: Iterating inward connections directly (no copy, no sort).
 * This is the new approach after Issue #1536.
 */
Deno.bench("inwardConnections direct iteration (no slice/sort)", () => {
  let total = 0;
  for (let i = numInputs; i < numNeurons; i++) {
    const inwardList = creature.inwardConnections(i);
    for (const s of inwardList) {
      total += s.from;
    }
  }
  // Prevent dead code elimination
  if (total < 0) throw new Error("unreachable");
});

/**
 * Previous approach: .slice().sort() on every iteration.
 * This is what was done before Issue #1536.
 */
Deno.bench("inwardConnections with .slice().sort() (old approach)", () => {
  let total = 0;
  for (let i = numInputs; i < numNeurons; i++) {
    const inwardList = creature.inwardConnections(i);
    const sorted: Synapse[] = inwardList.slice().sort((a, b) =>
      a.from - b.from
    );
    for (const s of sorted) {
      total += s.from;
    }
  }
  // Prevent dead code elimination
  if (total < 0) throw new Error("unreachable");
});
