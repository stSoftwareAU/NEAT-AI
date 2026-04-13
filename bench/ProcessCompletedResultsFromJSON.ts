/**
 * Benchmark for fromJSON construction in processCompletedResults.
 *
 * Issue #2276: Investigate whether fromJSON in processCompletedResults can
 * be optimised.
 *
 * Context: processCompletedResults (NeatEvolution.ts) calls Creature.fromJSON()
 * on CreatureExport objects received from workers. These are not round-trip
 * clones (there is no in-memory Creature to clone from), so shallowClone()
 * is not applicable. This benchmark documents the per-call cost for reference.
 *
 * Findings: The fromJSON calls are necessary since the data arrives as
 * CreatureExport objects from worker threads. The debug=false path already
 * skips validation, which is the optimal approach for trusted worker output.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/ProcessCompletedResultsFromJSON.ts
 */
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

// Create creatures and export to simulate worker results
const smallCreature = new Creature(10, 5, {
  layers: [{ count: 20 }],
});
smallCreature.uuid = "small-worker-result";
smallCreature.score = 0.85;
creatureValidate(smallCreature);
const smallJSON = smallCreature.exportJSON();

const mediumCreature = new Creature(50, 10, {
  layers: [{ count: 100 }, { count: 50 }],
});
mediumCreature.uuid = "medium-worker-result";
mediumCreature.score = 0.92;
creatureValidate(mediumCreature);
const mediumJSON = mediumCreature.exportJSON();

const largeCreature = new Creature(100, 20, {
  layers: [{ count: 200 }, { count: 100 }, { count: 50 }],
});
largeCreature.uuid = "large-worker-result";
largeCreature.score = 0.97;
creatureValidate(largeCreature);
const largeJSON = largeCreature.exportJSON();

console.log("=== processCompletedResults fromJSON Benchmark ===");
console.log(
  `Small: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `Medium: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);
console.log(
  "\nNote: These fromJSON calls reconstruct from worker CreatureExport objects.",
);
console.log(
  "shallowClone() is NOT applicable here (no in-memory Creature to clone).",
);
console.log(
  "debug=false already skips validation, which is optimal for trusted worker output.\n",
);

// Small creature: fromJSON with debug=false (production path)
Deno.bench({
  name: "Small creature - fromJSON (debug=false, production)",
  group: "Small worker result reconstruction",
  baseline: true,
  fn() {
    Creature.fromJSON(smallJSON, false);
  },
});

// Small creature: fromJSON with debug=true (debug path)
Deno.bench({
  name: "Small creature - fromJSON (debug=true)",
  group: "Small worker result reconstruction",
  fn() {
    Creature.fromJSON(smallJSON, true);
  },
});

// Medium creature benchmarks
Deno.bench({
  name: "Medium creature - fromJSON (debug=false, production)",
  group: "Medium worker result reconstruction",
  baseline: true,
  fn() {
    Creature.fromJSON(mediumJSON, false);
  },
});

Deno.bench({
  name: "Medium creature - fromJSON (debug=true)",
  group: "Medium worker result reconstruction",
  fn() {
    Creature.fromJSON(mediumJSON, true);
  },
});

// Large creature benchmarks
Deno.bench({
  name: "Large creature - fromJSON (debug=false, production)",
  group: "Large worker result reconstruction",
  baseline: true,
  fn() {
    Creature.fromJSON(largeJSON, false);
  },
});

Deno.bench({
  name: "Large creature - fromJSON (debug=true)",
  group: "Large worker result reconstruction",
  fn() {
    Creature.fromJSON(largeJSON, true);
  },
});
