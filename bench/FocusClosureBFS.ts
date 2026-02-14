/**
 * Benchmark: Iterative BFS focus closure vs cache-cleared per-query (Issue #1443)
 *
 * This benchmark measures the performance of the iterative BFS approach
 * that builds the entire focus closure once, compared to the previous
 * approach where the cache is cleared and rebuilt per-query.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/FocusClosureBFS.ts
 */
import { Creature } from "../src/Creature.ts";

// Create test creatures of various sizes
const smallCreature = new Creature(10, 5, { layers: [{ count: 10 }] });
const mediumCreature = new Creature(20, 10, { layers: [{ count: 50 }] });
const largeCreature = new Creature(30, 10, {
  layers: [{ count: 100 }, { count: 80 }, { count: 50 }],
});
const veryLargeCreature = new Creature(50, 20, {
  layers: [{ count: 150 }, { count: 150 }, { count: 150 }, { count: 100 }],
});

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
console.log(
  `Very Large: ${veryLargeCreature.neurons.length} neurons, ${veryLargeCreature.synapses.length} synapses`,
);

/**
 * Benchmark: Initial focus closure build (small creature).
 * Measures the cost of building the BFS closure from scratch.
 */
Deno.bench({
  name: "initial closure build (small, ~25 neurons)",
  group: "Initial closure build",
  fn() {
    const creature = Creature.fromJSON(smallCreature.exportJSON());
    const focusList = [1, 2, 3];
    // Clear and rebuild closure for all neurons
    creature.clearFocusCache();
    for (let j = 0; j < creature.neurons.length; j++) {
      creature.inFocus(j, focusList);
    }
  },
});

Deno.bench({
  name: "initial closure build (medium, ~80 neurons)",
  group: "Initial closure build",
  fn() {
    const creature = Creature.fromJSON(mediumCreature.exportJSON());
    const focusList = [5, 10, 15];
    creature.clearFocusCache();
    for (let j = 0; j < creature.neurons.length; j++) {
      creature.inFocus(j, focusList);
    }
  },
});

Deno.bench({
  name: "initial closure build (large, ~270 neurons)",
  group: "Initial closure build",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const focusList = [10, 50, 100];
    creature.clearFocusCache();
    for (let j = 0; j < creature.neurons.length; j++) {
      creature.inFocus(j, focusList);
    }
  },
});

Deno.bench({
  name: "initial closure build (very large, ~620 neurons)",
  group: "Initial closure build",
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const focusList = [20, 100, 300];
    creature.clearFocusCache();
    for (let j = 0; j < creature.neurons.length; j++) {
      creature.inFocus(j, focusList);
    }
  },
});

/**
 * Benchmark: Repeated inFocus lookups after closure is built.
 * The BFS approach computes the closure once; subsequent lookups are O(1) set checks.
 */
Deno.bench({
  name: "100 lookup iterations after closure (large, ~270 neurons)",
  group: "Cached lookups (large ~270 neurons)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const focusList = [10, 50, 100];
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});

Deno.bench({
  name: "100 lookup iterations (large, cache cleared each time)",
  group: "Cached lookups (large ~270 neurons)",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const focusList = [10, 50, 100];
    for (let i = 0; i < 100; i++) {
      creature.clearFocusCache();
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});

Deno.bench({
  name: "100 lookup iterations after closure (very large, ~620 neurons)",
  group: "Cached lookups (very large ~620 neurons)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const focusList = [20, 100, 300];
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});

Deno.bench({
  name: "100 lookup iterations (very large, cache cleared each time)",
  group: "Cached lookups (very large ~620 neurons)",
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const focusList = [20, 100, 300];
    for (let i = 0; i < 100; i++) {
      creature.clearFocusCache();
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});
