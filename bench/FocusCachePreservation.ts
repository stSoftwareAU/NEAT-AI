/**
 * Benchmark: Focus cache preservation within mutation batch (Issue #1100)
 *
 * This benchmark measures the performance improvement from preserving focus cache
 * across mutations within a batch when the focus list remains constant.
 *
 * The optimisation:
 * - Previously: Focus cache cleared on every structural change (clearCache())
 * - Now: Focus cache preserved unless focus list changes between mutations
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/FocusCachePreservation.ts
 */
import { Creature } from "../src/Creature.ts";
import { AddNeuron } from "../src/mutate/AddNeuron.ts";

// Create test creatures of various sizes
const smallCreature = new Creature(10, 5, { layers: [{ count: 10 }] });

const mediumCreature = new Creature(20, 10, { layers: [{ count: 50 }] });

const largeCreature = new Creature(30, 10, {
  layers: [{ count: 100 }, { count: 80 }, { count: 50 }],
});

// Create a very large creature to simulate production workloads (600+ neurons)
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
 * Benchmark: inFocus calls with cached results (small creature)
 *
 * Measures the benefit of caching focus results.
 */
Deno.bench({
  name: "100 inFocus calls (small, cached)",
  group: "Focus cache (small ~25 neurons)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(smallCreature.exportJSON());
    const focusList = [1, 2, 3];
    // First pass builds cache, subsequent passes use it
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});

/**
 * Benchmark: inFocus calls with cache cleared each iteration (simulating old behaviour)
 */
Deno.bench({
  name: "100 inFocus calls (small, cache cleared each iteration)",
  group: "Focus cache (small ~25 neurons)",
  fn() {
    const creature = Creature.fromJSON(smallCreature.exportJSON());
    const focusList = [1, 2, 3];
    // Simulate old behaviour: clear focus cache before each iteration
    for (let i = 0; i < 100; i++) {
      creature.clearFocusCache();
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});

/**
 * Benchmark: inFocus calls with cached results (medium creature)
 */
Deno.bench({
  name: "100 inFocus calls (medium, cached)",
  group: "Focus cache (medium ~80 neurons)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(mediumCreature.exportJSON());
    const focusList = [5, 10, 15];
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});

/**
 * Benchmark: inFocus calls with cache cleared each iteration (medium)
 */
Deno.bench({
  name: "100 inFocus calls (medium, cache cleared each iteration)",
  group: "Focus cache (medium ~80 neurons)",
  fn() {
    const creature = Creature.fromJSON(mediumCreature.exportJSON());
    const focusList = [5, 10, 15];
    for (let i = 0; i < 100; i++) {
      creature.clearFocusCache();
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
    }
  },
});

/**
 * Benchmark: inFocus calls with cached results (large creature)
 */
Deno.bench({
  name: "100 inFocus calls (large, cached)",
  group: "Focus cache (large ~270 neurons)",
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

/**
 * Benchmark: inFocus calls with cache cleared each iteration (large)
 */
Deno.bench({
  name: "100 inFocus calls (large, cache cleared each iteration)",
  group: "Focus cache (large ~270 neurons)",
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

/**
 * Benchmark: inFocus calls with cached results (very large creature)
 *
 * This is the scenario described in the issue: 619 neurons.
 */
Deno.bench({
  name: "100 inFocus calls (very large, cached)",
  group: "Focus cache (very large ~620 neurons)",
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

/**
 * Benchmark: inFocus calls with cache cleared each iteration (very large)
 */
Deno.bench({
  name: "100 inFocus calls (very large, cache cleared each iteration)",
  group: "Focus cache (very large ~620 neurons)",
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

/**
 * Benchmark: Mutation batch with focus list (simulating 3 mutations)
 *
 * This simulates the actual use case: mutationAmount=3 with focus list.
 */
Deno.bench({
  name: "3 mutations with focus (large, cached)",
  group: "Mutation batch (large ~270 neurons)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const focusList = [10, 50, 100];
    const addNeuron = new AddNeuron(creature);

    // Pre-build focus cache (first mutation establishes it)
    for (let j = 0; j < creature.neurons.length; j++) {
      creature.inFocus(j, focusList);
    }

    // Subsequent mutations use cached focus
    for (let i = 0; i < 3; i++) {
      addNeuron.mutate(focusList);
      // Note: clearCache() no longer clears focus cache
    }
  },
});

/**
 * Benchmark: Mutation batch with focus list (simulating old behaviour)
 */
Deno.bench({
  name: "3 mutations with focus (large, cache cleared)",
  group: "Mutation batch (large ~270 neurons)",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const focusList = [10, 50, 100];
    const addNeuron = new AddNeuron(creature);

    // Simulate old behaviour: focus cache cleared with each clearCache()
    for (let i = 0; i < 3; i++) {
      creature.clearFocusCache(); // Old behaviour: this was called by clearCache()
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
      addNeuron.mutate(focusList);
    }
  },
});

/**
 * Benchmark: Mutation batch with focus list (very large creature)
 */
Deno.bench({
  name: "3 mutations with focus (very large, cached)",
  group: "Mutation batch (very large ~620 neurons)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const focusList = [20, 100, 300];
    const addNeuron = new AddNeuron(creature);

    // Pre-build focus cache
    for (let j = 0; j < creature.neurons.length; j++) {
      creature.inFocus(j, focusList);
    }

    // Subsequent mutations use cached focus
    for (let i = 0; i < 3; i++) {
      addNeuron.mutate(focusList);
    }
  },
});

/**
 * Benchmark: Mutation batch with focus list (very large, old behaviour)
 */
Deno.bench({
  name: "3 mutations with focus (very large, cache cleared)",
  group: "Mutation batch (very large ~620 neurons)",
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const focusList = [20, 100, 300];
    const addNeuron = new AddNeuron(creature);

    // Simulate old behaviour
    for (let i = 0; i < 3; i++) {
      creature.clearFocusCache();
      for (let j = 0; j < creature.neurons.length; j++) {
        creature.inFocus(j, focusList);
      }
      addNeuron.mutate(focusList);
    }
  },
});
