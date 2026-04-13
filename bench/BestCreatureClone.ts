/**
 * Benchmark for bestCreature clone performance in CreatureTraining.ts.
 *
 * Issue #2276: Eliminate JSON round-trip in evolveDir bestCreature tracking.
 *
 * The evolveDir loop (CreatureTraining.ts) clones the fittest creature each
 * time a new best score is found. The original pattern:
 *
 *   bestCreature = CreatureClass.fromJSON(exportJSONWithRuntimeIds(fittest));
 *   bestCreature.uuid = fittest.uuid;
 *   bestCreature.score = bestScore;
 *
 * This performs a full JSON serialisation + deserialisation cycle. The
 * optimised pattern uses shallowClone(), which is already proven faster
 * (Issue #1025, Issue #1586):
 *
 *   bestCreature = fittest.shallowClone();
 *   bestCreature.score = bestScore;
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/BestCreatureClone.ts
 */
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";

// Create creatures of varying sizes to mirror production workloads
const smallCreature = new Creature(10, 5, {
  layers: [{ count: 20 }],
});
smallCreature.uuid = "small-best-creature-test";
smallCreature.score = 0.85;
creatureValidate(smallCreature);

const mediumCreature = new Creature(50, 10, {
  layers: [{ count: 100 }, { count: 50 }],
});
mediumCreature.uuid = "medium-best-creature-test";
mediumCreature.score = 0.92;
creatureValidate(mediumCreature);

const largeCreature = new Creature(100, 20, {
  layers: [{ count: 200 }, { count: 100 }, { count: 50 }],
});
largeCreature.uuid = "large-best-creature-test";
largeCreature.score = 0.97;
creatureValidate(largeCreature);

console.log("=== Creature Sizes ===");
console.log(
  `Small: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `Medium: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

// Small creature benchmarks
Deno.bench({
  name: "Small creature - exportJSONWithRuntimeIds + fromJSON (baseline)",
  group: "Small bestCreature clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(exportJSONWithRuntimeIds(smallCreature));
    clone.uuid = smallCreature.uuid;
    clone.score = smallCreature.score;
  },
});

Deno.bench({
  name: "Small creature - shallowClone (optimised)",
  group: "Small bestCreature clone",
  fn() {
    const clone = smallCreature.shallowClone();
    clone.score = smallCreature.score;
  },
});

// Medium creature benchmarks
Deno.bench({
  name: "Medium creature - exportJSONWithRuntimeIds + fromJSON (baseline)",
  group: "Medium bestCreature clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(exportJSONWithRuntimeIds(mediumCreature));
    clone.uuid = mediumCreature.uuid;
    clone.score = mediumCreature.score;
  },
});

Deno.bench({
  name: "Medium creature - shallowClone (optimised)",
  group: "Medium bestCreature clone",
  fn() {
    const clone = mediumCreature.shallowClone();
    clone.score = mediumCreature.score;
  },
});

// Large creature benchmarks
Deno.bench({
  name: "Large creature - exportJSONWithRuntimeIds + fromJSON (baseline)",
  group: "Large bestCreature clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(exportJSONWithRuntimeIds(largeCreature));
    clone.uuid = largeCreature.uuid;
    clone.score = largeCreature.score;
  },
});

Deno.bench({
  name: "Large creature - shallowClone (optimised)",
  group: "Large bestCreature clone",
  fn() {
    const clone = largeCreature.shallowClone();
    clone.score = largeCreature.score;
  },
});
