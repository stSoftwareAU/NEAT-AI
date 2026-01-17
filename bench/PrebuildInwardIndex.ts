/**
 * Benchmark: Prebuild inward synapse index after breed/mutation batch (Issue #1097)
 *
 * This benchmark measures the performance improvement from proactively prebuilding
 * the inward synapse index after breeding and mutation operations.
 *
 * The optimisation:
 * - Previously: Lazy index building after 3 cache misses caused O(n) linear scans
 * - Now: Proactive prebuilding for large creatures (>= 1000 synapses) eliminates
 *   repeated linear scans during subsequent operations
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/PrebuildInwardIndex.ts
 */
import { Creature } from "../src/Creature.ts";
import { Offspring } from "../src/architecture/Offspring.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";

// Create parent creatures for breeding benchmarks
const largeMum = new Creature(30, 10, {
  layers: [{ count: 100 }, { count: 80 }, { count: 50 }],
});
largeMum.validate();

const largeDad = new Creature(30, 10, {
  layers: [{ count: 90 }, { count: 70 }, { count: 60 }],
});
largeDad.validate();

console.log("=== Creature Sizes ===");
console.log(
  `Parent (mum): ${largeMum.neurons.length} neurons, ${largeMum.synapses.length} synapses`,
);
console.log(
  `Parent (dad): ${largeDad.neurons.length} neurons, ${largeDad.synapses.length} synapses`,
);

// Create mutator for mutation benchmarks
const config = createNeatConfig({
  mutationRate: 1.0,
  mutationAmount: 3,
});
const mutator = new Mutator(config);

/**
 * Benchmark: Offspring.breed() with prebuild
 *
 * This measures the full breeding process including the prebuild optimisation.
 * The offspring will have its inward index prebuilt immediately after connecting
 * all synapses, which benefits subsequent validation and memetic updates.
 */
Deno.bench({
  name: "Offspring.breed() with prebuild (current)",
  group: "Breeding performance",
  baseline: true,
  fn() {
    const offspring = Offspring.breed(largeMum, largeDad);
    if (offspring) {
      // Simulate typical post-breeding operations that use inward connections
      offspring.validate();
      for (let i = 0; i < 5; i++) {
        const randomIndex = Math.floor(
          Math.random() * (offspring.neurons.length - offspring.input),
        ) + offspring.input;
        offspring.inwardConnections(randomIndex);
      }
    }
  },
});

/**
 * Benchmark: Breeding + multiple inward lookups
 *
 * This demonstrates the benefit when many inward lookups are performed
 * immediately after breeding (e.g., during validation or memetic updates).
 */
Deno.bench({
  name: "Breeding + 20 inward lookups",
  group: "Post-breeding operations",
  fn() {
    const offspring = Offspring.breed(largeMum, largeDad);
    if (offspring) {
      // Simulate many inward lookups that benefit from prebuild
      for (let i = 0; i < 20; i++) {
        const randomIndex = Math.floor(
          Math.random() * (offspring.neurons.length - offspring.input),
        ) + offspring.input;
        offspring.inwardConnections(randomIndex);
      }
    }
  },
});

/**
 * Benchmark: Mutation batch with prebuild
 *
 * This measures mutation performance when the prebuild optimisation is applied.
 * After the mutation batch, the inward index is prebuilt for large creatures.
 */
Deno.bench({
  name: "Mutation batch + inward lookups",
  group: "Mutation performance",
  fn() {
    // Clone a large creature for mutation
    const creature = Creature.fromJSON(largeMum.exportJSON());

    // Mutate the creature (this triggers prebuild for large creatures)
    mutator.mutate([creature]);

    // Simulate post-mutation operations that use inward connections
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(
        Math.random() * (creature.neurons.length - creature.input),
      ) + creature.input;
      creature.inwardConnections(randomIndex);
    }
  },
});

/**
 * Benchmark: Load from JSON with prebuild
 *
 * This measures the performance of loading a large creature and immediately
 * performing inward lookups, which now benefits from the prebuild optimisation.
 */
Deno.bench({
  name: "Load from JSON + inward lookups",
  group: "Loading performance",
  fn() {
    const json = largeMum.exportJSON();
    const creature = Creature.fromJSON(json);

    // Simulate operations that use inward connections
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(
        Math.random() * (creature.neurons.length - creature.input),
      ) + creature.input;
      creature.inwardConnections(randomIndex);
    }
  },
});

/**
 * Benchmark: Without prebuild (simulated baseline)
 *
 * This simulates the old behaviour by clearing the index after operations
 * and measuring the cost of lazy rebuilding.
 */
Deno.bench({
  name: "Load + clear cache + inward lookups (no prebuild simulation)",
  group: "Loading performance",
  fn() {
    const json = largeMum.exportJSON();
    const creature = Creature.fromJSON(json);

    // Simulate the old behaviour by clearing the prebuilt index
    creature.clearCache();

    // This will now use the lazy build (after 3 cache misses)
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(
        Math.random() * (creature.neurons.length - creature.input),
      ) + creature.input;
      creature.inwardConnections(randomIndex);
    }
  },
});
