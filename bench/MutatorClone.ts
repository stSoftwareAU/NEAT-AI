/**
 * Benchmark for Mutator.mutate clone performance optimisation.
 *
 * Issue #1586: Optimise Cloning in Mutator - Use shallowClone instead of
 * JSON serialisation.
 *
 * The Mutator.mutate() method clones creatures using expensive
 * JSON serialisation/deserialisation:
 *   const original = Creature.fromJSON(creature.exportJSON());
 *   original.score = creature.score;
 *
 * This benchmark compares that approach against:
 *   const original = creature.shallowClone();
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/MutatorClone.ts
 */
import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

// Create creatures of varying sizes to test performance scaling
const smallCreature = new Creature(10, 5, {
  layers: [{ count: 20 }],
});
smallCreature.uuid = "small-mutator-test";
smallCreature.score = 0.85;
smallCreature.memetic = { generation: 3, score: 0.7, weights: {}, biases: {} };
creatureValidate(smallCreature);

const mediumCreature = new Creature(50, 10, {
  layers: [{ count: 100 }, { count: 50 }],
});
mediumCreature.uuid = "medium-mutator-test";
mediumCreature.score = 0.72;
mediumCreature.memetic = { generation: 5, score: 0.6, weights: {}, biases: {} };
creatureValidate(mediumCreature);

const largeCreature = new Creature(100, 20, {
  layers: [{ count: 200 }, { count: 100 }, { count: 50 }],
});
largeCreature.uuid = "large-mutator-test";
largeCreature.score = 0.93;
largeCreature.memetic = { generation: 10, score: 0.8, weights: {}, biases: {} };
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
  group: "Small creature mutator clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(smallCreature.exportJSON());
    clone.score = smallCreature.score;
    if (clone.neurons.length === 0) throw new Error("Empty clone");
  },
});

Deno.bench({
  name: "Small creature - shallowClone (optimised)",
  group: "Small creature mutator clone",
  fn() {
    const clone = smallCreature.shallowClone();
    if (clone.neurons.length === 0) throw new Error("Empty clone");
  },
});

// Medium creature benchmarks
Deno.bench({
  name: "Medium creature - JSON clone (baseline)",
  group: "Medium creature mutator clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(mediumCreature.exportJSON());
    clone.score = mediumCreature.score;
    if (clone.neurons.length === 0) throw new Error("Empty clone");
  },
});

Deno.bench({
  name: "Medium creature - shallowClone (optimised)",
  group: "Medium creature mutator clone",
  fn() {
    const clone = mediumCreature.shallowClone();
    if (clone.neurons.length === 0) throw new Error("Empty clone");
  },
});

// Large creature benchmarks
Deno.bench({
  name: "Large creature - JSON clone (baseline)",
  group: "Large creature mutator clone",
  baseline: true,
  fn() {
    const clone = Creature.fromJSON(largeCreature.exportJSON());
    clone.score = largeCreature.score;
    if (clone.neurons.length === 0) throw new Error("Empty clone");
  },
});

Deno.bench({
  name: "Large creature - shallowClone (optimised)",
  group: "Large creature mutator clone",
  fn() {
    const clone = largeCreature.shallowClone();
    if (clone.neurons.length === 0) throw new Error("Empty clone");
  },
});
