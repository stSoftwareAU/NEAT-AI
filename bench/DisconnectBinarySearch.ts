/**
 * Benchmark: Binary search disconnect (Issue #1101)
 *
 * This benchmark measures the performance improvement from using binary search
 * instead of linear search in the disconnect() method.
 *
 * The key scenario being optimised:
 * - Large creatures with many synapses (10,000+)
 * - Multiple disconnect operations during evolution
 * - SubConnection mutation removing synapses
 *
 * Run with: deno bench --allow-read bench/DisconnectBinarySearch.ts
 *
 * Expected results:
 * - Linear search: O(n) - scans entire synapses array
 * - Binary search: O(log n) - much faster for large creatures
 *
 * For a creature with 10,000 synapses:
 * - Linear search average: ~5,000 comparisons per disconnect
 * - Binary search average: ~14 comparisons per disconnect
 *
 * Performance comparison (Apple M4 Pro):
 * Before (linear search):
 *   1000 disconnects on 10k synapses: ~X ms
 *
 * After (binary search):
 *   1000 disconnects on 10k synapses: ~Y ms
 */

import { Creature } from "../src/Creature.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";

/**
 * Creates a creature with a specified approximate number of synapses.
 * Uses a layered architecture to achieve the target synapse count.
 */
function createLargeCreature(targetSynapses: number): Creature {
  // For a fully connected network with L layers of N neurons each:
  // synapses ≈ input * hidden1 + hidden1 * hidden2 + ... + hiddenL * output
  // For simplicity, we'll use a single hidden layer
  // synapses ≈ input * hidden + hidden * output

  // Solve for hidden layer size to get target synapses
  // With input=50, output=5: synapses ≈ 50*h + h*5 = 55h
  // So h ≈ targetSynapses / 55

  const inputCount = 50;
  const outputCount = 5;
  const hiddenCount = Math.ceil(targetSynapses / (inputCount + outputCount));

  const creature = new Creature(inputCount, outputCount, {
    layers: [{ count: hiddenCount, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });

  return creature;
}

// Create creatures of different sizes for benchmarking
const smallCreature = createLargeCreature(100);
const mediumCreature = createLargeCreature(1000);
const largeCreature = createLargeCreature(10000);

console.log(
  `Small creature: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `Medium creature: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large creature: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

/**
 * Prepares a list of synapse (from, to) pairs to disconnect.
 * Returns pairs that can be disconnected and then reconnected.
 */
function prepareSynapsePairs(
  creature: Creature,
  count: number,
): { from: number; to: number; weight: number }[] {
  const pairs: { from: number; to: number; weight: number }[] = [];
  const step = Math.max(1, Math.floor(creature.synapses.length / count));

  for (let i = 0; i < count && i * step < creature.synapses.length; i++) {
    const synapse = creature.synapses[i * step];
    pairs.push({ from: synapse.from, to: synapse.to, weight: synapse.weight });
  }

  return pairs;
}

// Prepare disconnect operations for each creature size
const smallPairs = prepareSynapsePairs(smallCreature, 50);
const mediumPairs = prepareSynapsePairs(mediumCreature, 100);
const largePairs = prepareSynapsePairs(largeCreature, 100);

/**
 * Benchmark: Small creature disconnect operations
 */
Deno.bench(
  "disconnect (small: ~100 synapses)",
  { group: "disconnect" },
  () => {
    // Disconnect all prepared synapses
    for (const pair of smallPairs) {
      smallCreature.disconnect(pair.from, pair.to);
    }
    // Reconnect them for the next iteration
    for (const pair of smallPairs) {
      smallCreature.connect(pair.from, pair.to, pair.weight);
    }
  },
);

/**
 * Benchmark: Medium creature disconnect operations
 */
Deno.bench(
  "disconnect (medium: ~1000 synapses)",
  { group: "disconnect" },
  () => {
    // Disconnect all prepared synapses
    for (const pair of mediumPairs) {
      mediumCreature.disconnect(pair.from, pair.to);
    }
    // Reconnect them for the next iteration
    for (const pair of mediumPairs) {
      mediumCreature.connect(pair.from, pair.to, pair.weight);
    }
  },
);

/**
 * Benchmark: Large creature disconnect operations
 */
Deno.bench(
  "disconnect (large: ~10000 synapses)",
  { group: "disconnect" },
  () => {
    // Disconnect all prepared synapses
    for (const pair of largePairs) {
      largeCreature.disconnect(pair.from, pair.to);
    }
    // Reconnect them for the next iteration
    for (const pair of largePairs) {
      largeCreature.connect(pair.from, pair.to, pair.weight);
    }
  },
);

/**
 * Benchmark: Worst case - disconnecting from the end of sorted array
 * Linear search would need to scan entire array to find these.
 */
Deno.bench(
  "disconnect (large: last synapses)",
  { group: "disconnect-worst-case" },
  () => {
    // Get the last 10 synapses (worst case for linear search)
    const lastSynapses = largeCreature.synapses.slice(-10).map((s) => ({
      from: s.from,
      to: s.to,
      weight: s.weight,
    }));

    for (const pair of lastSynapses) {
      largeCreature.disconnect(pair.from, pair.to);
    }

    for (const pair of lastSynapses) {
      largeCreature.connect(pair.from, pair.to, pair.weight);
    }
  },
);

/**
 * Benchmark: Best case - disconnecting from the start of sorted array
 * Linear search finds these immediately.
 */
Deno.bench(
  "disconnect (large: first synapses)",
  { group: "disconnect-worst-case" },
  () => {
    // Get the first 10 synapses (best case for linear search)
    const firstSynapses = largeCreature.synapses.slice(0, 10).map((s) => ({
      from: s.from,
      to: s.to,
      weight: s.weight,
    }));

    for (const pair of firstSynapses) {
      largeCreature.disconnect(pair.from, pair.to);
    }

    for (const pair of firstSynapses) {
      largeCreature.connect(pair.from, pair.to, pair.weight);
    }
  },
);

/**
 * Benchmark: Non-existent synapse (not found case)
 */
Deno.bench(
  "disconnect (not found)",
  { group: "disconnect-edge-cases" },
  () => {
    // Try to disconnect synapses that don't exist
    for (let i = 0; i < 100; i++) {
      largeCreature.disconnect(9999, 9999);
    }
  },
);
