/**
 * Benchmark for batch synapse operations performance optimisation.
 *
 * Issue #1102: Performance - Batch synapse operations to reduce cache invalidation overhead
 *
 * This benchmark compares:
 * 1. Individual connect() calls (each triggers cache invalidation)
 * 2. connectBatch() (single cache invalidation at the end)
 *
 * The optimisation reduces cache invalidation from O(n) to O(1) for operations
 * that add multiple synapses, which is particularly beneficial during breeding
 * where many synapses are added to create offspring.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/BatchSynapseOperations.ts
 */
import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";
import { AddNeuron } from "../src/mutate/AddNeuron.ts";

// Helper to create test creatures with available connections
function createTestCreature(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);
  const addNeuron = new AddNeuron(creature);

  for (let i = 0; i < hiddenNeurons; i++) {
    addNeuron.mutate();
  }

  return creature;
}

// Small creature setup
const smallCreature = createTestCreature(10, 5, 20);
creatureValidate(smallCreature);
const smallAvailable = smallCreature.getAvailableConnections();
const smallConnections = smallAvailable.slice(0, 50).map(([from, to]) => ({
  from,
  to,
  weight: Math.random() * 2 - 1,
}));

// Medium creature setup
const mediumCreature = createTestCreature(30, 10, 80);
creatureValidate(mediumCreature);
const mediumAvailable = mediumCreature.getAvailableConnections();
const mediumConnections = mediumAvailable.slice(0, 200).map(([from, to]) => ({
  from,
  to,
  weight: Math.random() * 2 - 1,
}));

// Large creature setup (matching issue requirements)
const largeCreature = createTestCreature(50, 20, 200);
creatureValidate(largeCreature);
const largeAvailable = largeCreature.getAvailableConnections();
const largeConnections = largeAvailable.slice(0, 500).map(([from, to]) => ({
  from,
  to,
  weight: Math.random() * 2 - 1,
}));

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

console.log("\n=== Connections to Add ===");
console.log(`Small: ${smallConnections.length} connections`);
console.log(`Medium: ${mediumConnections.length} connections`);
console.log(`Large: ${largeConnections.length} connections`);

// =============================================================================
// Small Creature Benchmarks (50 connections)
// =============================================================================

Deno.bench({
  name: "Small (50 conn): Individual connect() calls",
  group: "connectBatch vs individual connect",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(smallCreature.exportJSON());
    for (const conn of smallConnections) {
      creature.connect(conn.from, conn.to, conn.weight);
    }
  },
});

Deno.bench({
  name: "Small (50 conn): connectBatch()",
  group: "connectBatch vs individual connect",
  fn() {
    const creature = Creature.fromJSON(smallCreature.exportJSON());
    creature.connectBatch(smallConnections);
  },
});

// =============================================================================
// Medium Creature Benchmarks (200 connections)
// =============================================================================

Deno.bench({
  name: "Medium (200 conn): Individual connect() calls",
  group: "connectBatch vs individual connect (medium)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(mediumCreature.exportJSON());
    for (const conn of mediumConnections) {
      creature.connect(conn.from, conn.to, conn.weight);
    }
  },
});

Deno.bench({
  name: "Medium (200 conn): connectBatch()",
  group: "connectBatch vs individual connect (medium)",
  fn() {
    const creature = Creature.fromJSON(mediumCreature.exportJSON());
    creature.connectBatch(mediumConnections);
  },
});

// =============================================================================
// Large Creature Benchmarks (500 connections)
// =============================================================================

Deno.bench({
  name: "Large (500 conn): Individual connect() calls",
  group: "connectBatch vs individual connect (large)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    for (const conn of largeConnections) {
      creature.connect(conn.from, conn.to, conn.weight);
    }
  },
});

Deno.bench({
  name: "Large (500 conn): connectBatch()",
  group: "connectBatch vs individual connect (large)",
  fn() {
    const creature = Creature.fromJSON(largeCreature.exportJSON());
    creature.connectBatch(largeConnections);
  },
});

// =============================================================================
// Disconnect Benchmarks
// =============================================================================

// Create creatures with connections to disconnect
const disconnectSmall = Creature.fromJSON(smallCreature.exportJSON());
disconnectSmall.connectBatch(smallConnections);
const disconnectSmallPairs = smallConnections.slice(0, 30).map((c) => ({
  from: c.from,
  to: c.to,
}));

const disconnectMedium = Creature.fromJSON(mediumCreature.exportJSON());
disconnectMedium.connectBatch(mediumConnections);
const disconnectMediumPairs = mediumConnections.slice(0, 100).map((c) => ({
  from: c.from,
  to: c.to,
}));

const disconnectLarge = Creature.fromJSON(largeCreature.exportJSON());
disconnectLarge.connectBatch(largeConnections);
const disconnectLargePairs = largeConnections.slice(0, 250).map((c) => ({
  from: c.from,
  to: c.to,
}));

console.log("\n=== Connections to Remove ===");
console.log(`Small: ${disconnectSmallPairs.length} connections`);
console.log(`Medium: ${disconnectMediumPairs.length} connections`);
console.log(`Large: ${disconnectLargePairs.length} connections`);

Deno.bench({
  name: "Small (30 disc): Individual disconnect() calls",
  group: "disconnectBatch vs individual disconnect",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(disconnectSmall.exportJSON());
    for (const pair of disconnectSmallPairs) {
      creature.disconnect(pair.from, pair.to);
    }
  },
});

Deno.bench({
  name: "Small (30 disc): disconnectBatch()",
  group: "disconnectBatch vs individual disconnect",
  fn() {
    const creature = Creature.fromJSON(disconnectSmall.exportJSON());
    creature.disconnectBatch(disconnectSmallPairs);
  },
});

Deno.bench({
  name: "Medium (100 disc): Individual disconnect() calls",
  group: "disconnectBatch vs individual disconnect (medium)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(disconnectMedium.exportJSON());
    for (const pair of disconnectMediumPairs) {
      creature.disconnect(pair.from, pair.to);
    }
  },
});

Deno.bench({
  name: "Medium (100 disc): disconnectBatch()",
  group: "disconnectBatch vs individual disconnect (medium)",
  fn() {
    const creature = Creature.fromJSON(disconnectMedium.exportJSON());
    creature.disconnectBatch(disconnectMediumPairs);
  },
});

Deno.bench({
  name: "Large (250 disc): Individual disconnect() calls",
  group: "disconnectBatch vs individual disconnect (large)",
  baseline: true,
  fn() {
    const creature = Creature.fromJSON(disconnectLarge.exportJSON());
    for (const pair of disconnectLargePairs) {
      creature.disconnect(pair.from, pair.to);
    }
  },
});

Deno.bench({
  name: "Large (250 disc): disconnectBatch()",
  group: "disconnectBatch vs individual disconnect (large)",
  fn() {
    const creature = Creature.fromJSON(disconnectLarge.exportJSON());
    creature.disconnectBatch(disconnectLargePairs);
  },
});
