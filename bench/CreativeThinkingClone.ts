/**
 * Benchmark for creative thinking clone performance optimisation.
 *
 * Issue #1040: Performance - Reduce JSON cloning in creative thinking creature creation.
 *
 * The creative thinking process in Neat.evolve() creates a clone of the fittest
 * creature to add random connections. Previously this used expensive JSON
 * serialisation/deserialisation:
 *   const creativeThinking = Creature.fromJSON(n.exportJSON());
 *
 * This has been optimised to use shallowClone():
 *   const creativeThinking = n.shallowClone();
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/CreativeThinkingClone.ts
 */
import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";

// Create creatures of varying sizes to test performance scaling
const smallCreature = new Creature(10, 5, {
  layers: [{ count: 20 }],
});
smallCreature.uuid = "small-perf-test";
smallCreature.score = 0.95;
smallCreature.memetic = {
  generation: 20,
  weights: {},
  biases: {},
  score: 0.9,
};
creatureValidate(smallCreature);

const mediumCreature = new Creature(50, 10, {
  layers: [{ count: 100 }, { count: 50 }],
});
mediumCreature.uuid = "medium-perf-test";
mediumCreature.score = 0.95;
mediumCreature.memetic = {
  generation: 20,
  weights: {},
  biases: {},
  score: 0.9,
};
creatureValidate(mediumCreature);

const largeCreature = new Creature(100, 20, {
  layers: [{ count: 200 }, { count: 100 }, { count: 50 }],
});
largeCreature.uuid = "large-perf-test";
largeCreature.score = 0.95;
largeCreature.memetic = {
  generation: 20,
  weights: {},
  biases: {},
  score: 0.9,
};
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
  name: "Small creature - JSON clone (old method)",
  group: "Small creature cloning",
  baseline: true,
  fn() {
    const jsonClone = Creature.fromJSON(smallCreature.exportJSON());
    delete jsonClone.memetic;
    creatureValidate(jsonClone);
  },
});

Deno.bench({
  name: "Small creature - shallowClone (new method)",
  group: "Small creature cloning",
  fn() {
    const shallowClone = smallCreature.shallowClone();
    delete shallowClone.memetic;
    creatureValidate(shallowClone);
  },
});

// Medium creature benchmarks
Deno.bench({
  name: "Medium creature - JSON clone (old method)",
  group: "Medium creature cloning",
  baseline: true,
  fn() {
    const jsonClone = Creature.fromJSON(mediumCreature.exportJSON());
    delete jsonClone.memetic;
    creatureValidate(jsonClone);
  },
});

Deno.bench({
  name: "Medium creature - shallowClone (new method)",
  group: "Medium creature cloning",
  fn() {
    const shallowClone = mediumCreature.shallowClone();
    delete shallowClone.memetic;
    creatureValidate(shallowClone);
  },
});

// Large creature benchmarks
Deno.bench({
  name: "Large creature - JSON clone (old method)",
  group: "Large creature cloning",
  baseline: true,
  fn() {
    const jsonClone = Creature.fromJSON(largeCreature.exportJSON());
    delete jsonClone.memetic;
    creatureValidate(jsonClone);
  },
});

Deno.bench({
  name: "Large creature - shallowClone (new method)",
  group: "Large creature cloning",
  fn() {
    const shallowClone = largeCreature.shallowClone();
    delete shallowClone.memetic;
    creatureValidate(shallowClone);
  },
});
