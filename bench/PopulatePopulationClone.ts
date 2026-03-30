/**
 * Benchmark for populatePopulation clone performance optimisation.
 *
 * Issue #1474: Performance - Reduce serialisation overhead in evolution loop.
 *
 * The populatePopulation() method in Neat.ts clones creatures using expensive
 * JSON serialisation/deserialisation:
 *   const clonedCreature = Creature.fromJSON(creature.exportJSON(), debug);
 *
 * This has been optimised to use shallowClone():
 *   const clonedCreature = creature.shallowClone();
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/PopulatePopulationClone.ts
 */
import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

// Create creatures of varying sizes to test performance scaling
const smallCreature = new Creature(10, 5, {
  layers: [{ count: 20 }],
});
smallCreature.uuid = "small-populate-test";
smallCreature.score = 0.85;
creatureValidate(smallCreature);

const mediumCreature = new Creature(50, 10, {
  layers: [{ count: 100 }, { count: 50 }],
});
mediumCreature.uuid = "medium-populate-test";
mediumCreature.score = 0.85;
creatureValidate(mediumCreature);

const largeCreature = new Creature(100, 20, {
  layers: [{ count: 200 }, { count: 100 }, { count: 50 }],
});
largeCreature.uuid = "large-populate-test";
largeCreature.score = 0.85;
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
  name: "Small creature - JSON clone (baseline)",
  group: "Small creature populate clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(smallCreature.exportJSON());
    creatureValidate(clone);
  },
});

Deno.bench({
  name: "Small creature - shallowClone (optimised)",
  group: "Small creature populate clone",
  fn() {
    const clone = smallCreature.shallowClone();
    creatureValidate(clone);
  },
});

// Medium creature benchmarks
Deno.bench({
  name: "Medium creature - JSON clone (baseline)",
  group: "Medium creature populate clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(mediumCreature.exportJSON());
    creatureValidate(clone);
  },
});

Deno.bench({
  name: "Medium creature - shallowClone (optimised)",
  group: "Medium creature populate clone",
  fn() {
    const clone = mediumCreature.shallowClone();
    creatureValidate(clone);
  },
});

// Large creature benchmarks
Deno.bench({
  name: "Large creature - JSON clone (baseline)",
  group: "Large creature populate clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(largeCreature.exportJSON());
    creatureValidate(clone);
  },
});

Deno.bench({
  name: "Large creature - shallowClone (optimised)",
  group: "Large creature populate clone",
  fn() {
    const clone = largeCreature.shallowClone();
    creatureValidate(clone);
  },
});
