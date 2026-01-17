/**
 * Benchmark: Cache available connection pairs for AddConnection mutation (Issue #1098)
 *
 * This benchmark measures the performance improvement from caching available
 * connection pairs instead of recomputing them on every AddConnection mutation.
 *
 * The optimisation:
 * - Previously: O(n²) iteration through all neuron pairs on every mutation
 * - Now: Cache built once, O(1) retrieval on subsequent mutations (until invalidated)
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/AvailableConnectionsCache.ts
 */
import { Creature } from "../src/Creature.ts";
import { AddConnection } from "../src/mutate/AddConnection.ts";
import { AddNeuron } from "../src/mutate/AddNeuron.ts";

// Create test creatures of various sizes
const smallCreature = new Creature(10, 5);
const addNeuronSmall = new AddNeuron(smallCreature);
for (let i = 0; i < 20; i++) {
  addNeuronSmall.mutate();
}

const mediumCreature = new Creature(20, 10);
const addNeuronMedium = new AddNeuron(mediumCreature);
for (let i = 0; i < 100; i++) {
  addNeuronMedium.mutate();
}

const largeCreature = new Creature(30, 10, {
  layers: [{ count: 100 }, { count: 80 }, { count: 50 }],
});

// Create even larger creature to simulate production workloads (600+ neurons)
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
 * Benchmark: Single AddConnection mutation (small creature)
 *
 * Measures single mutation performance with cache.
 */
Deno.bench({
  name: "Single AddConnection (small, ~35 neurons)",
  group: "Single mutation",
  fn() {
    const creature = Creature.fromJSON(smallCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    addConnection.mutate();
  },
});

/**
 * Benchmark: Single AddConnection mutation (medium creature)
 */
Deno.bench({
  name: "Single AddConnection (medium, ~130 neurons)",
  group: "Single mutation",
  fn() {
    const creature = Creature.fromJSON(mediumCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    addConnection.mutate();
  },
});

/**
 * Benchmark: Single AddConnection mutation (large creature)
 */
Deno.bench({
  name: "Single AddConnection (large, ~270 neurons)",
  group: "Single mutation",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    addConnection.mutate();
  },
});

/**
 * Benchmark: Single AddConnection mutation (very large creature)
 */
Deno.bench({
  name: "Single AddConnection (very large, ~620 neurons)",
  group: "Single mutation",
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    addConnection.mutate();
  },
});

/**
 * Benchmark: Multiple AddConnection mutations with cache (small)
 *
 * This shows the benefit of caching when multiple mutations are performed
 * on the same creature without structure changes.
 */
Deno.bench({
  name: "100 AddConnections cached (small, ~35 neurons)",
  group: "Multiple mutations (cached)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(smallCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    for (let i = 0; i < 100; i++) {
      addConnection.mutate();
    }
  },
});

/**
 * Benchmark: Multiple AddConnection mutations with cache (medium)
 */
Deno.bench({
  name: "100 AddConnections cached (medium, ~130 neurons)",
  group: "Multiple mutations (cached)",
  fn() {
    const creature = Creature.fromJSON(mediumCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    for (let i = 0; i < 100; i++) {
      addConnection.mutate();
    }
  },
});

/**
 * Benchmark: Multiple AddConnection mutations with cache (large)
 */
Deno.bench({
  name: "100 AddConnections cached (large, ~270 neurons)",
  group: "Multiple mutations (cached)",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    for (let i = 0; i < 100; i++) {
      addConnection.mutate();
    }
  },
});

/**
 * Benchmark: Multiple AddConnection mutations with cache (very large)
 */
Deno.bench({
  name: "100 AddConnections cached (very large, ~620 neurons)",
  group: "Multiple mutations (cached)",
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    for (let i = 0; i < 100; i++) {
      addConnection.mutate();
    }
  },
});

/**
 * Benchmark: getAvailableConnections() call (cached) - 10 calls
 *
 * Measures the cost of retrieving available connections when cached.
 * First call builds the cache, subsequent calls should be nearly free.
 */
Deno.bench({
  name: "getAvailableConnections 10 calls (large, cached)",
  group: "Cache access",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    // First call builds the cache, subsequent calls use it
    for (let i = 0; i < 10; i++) {
      creature.getAvailableConnections();
    }
  },
});

/**
 * Benchmark: getAvailableConnections() call (uncached simulation)
 *
 * Simulates the old behaviour by clearing the cache before each call.
 * This forces recomputation on every call.
 */
Deno.bench({
  name: "getAvailableConnections 10 calls (large, uncached)",
  group: "Cache access",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    // Simulate uncached behaviour by clearing cache before each call
    for (let i = 0; i < 10; i++) {
      creature.clearCache();
      creature.getAvailableConnections();
    }
  },
});

/**
 * Benchmark: getAvailableConnections() cached access only
 *
 * This measures just the cache hit cost (excluding initial build).
 */
Deno.bench({
  name: "getAvailableConnections cache hit only (large)",
  group: "Cache hit performance",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    // Build cache first
    creature.getAvailableConnections();
    // Now measure just the cache hit cost
    for (let i = 0; i < 100; i++) {
      creature.getAvailableConnections();
    }
  },
});

/**
 * Benchmark: getAvailableConnections() with focus list (cached)
 *
 * Measures the performance when filtering by focus list.
 */
Deno.bench({
  name: "getAvailableConnections with focus list (large, ~270 neurons)",
  group: "Focus list filtering",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    const focusList = [50, 100, 150]; // Sample focus indices
    for (let i = 0; i < 10; i++) {
      creature.getAvailableConnections(focusList);
    }
  },
});

/**
 * Benchmark: Very large creature to match issue description (619 neurons)
 *
 * The issue mentions creatures with 619 neurons and ~190,000 pairs.
 * This benchmark measures the exact scenario described.
 */
Deno.bench({
  name: "100 AddConnections (production-sized ~620 neurons)",
  group: "Production workload",
  fn() {
    const creature = Creature.fromJSON(veryLargeCreature.exportJSON());
    const addConnection = new AddConnection(creature);
    for (let i = 0; i < 100; i++) {
      addConnection.mutate();
    }
  },
});
