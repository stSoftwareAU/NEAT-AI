/**
 * Benchmark for breeding crossover with reduced Map/object allocation.
 *
 * Issue #1644: Benchmark & investigate optimising breeding crossover
 * with reduced Map/object allocation.
 *
 * Measures the full breeding pipeline including:
 * - Gene alignment (Father.ts UUID remapping)
 * - Offspring.breed() crossover
 * - cloneConnections allocation
 * - sortNeurons topology reconstruction
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/BreedCrossoverAllocation.ts
 */
import { Creature } from "../src/Creature.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

// === Small creatures (~20 neurons) ===
const smallMum = new Creature(5, 3, {
  layers: [{ count: 8 }, { count: 4 }],
});
creatureValidate(smallMum);

const smallDad = new Creature(5, 3, {
  layers: [{ count: 6 }, { count: 5 }],
});
creatureValidate(smallDad);

// === Medium creatures (~200 neurons) ===
const mediumMum = new Creature(20, 10, {
  layers: [{ count: 80 }, { count: 60 }, { count: 30 }],
});
creatureValidate(mediumMum);

const mediumDad = new Creature(20, 10, {
  layers: [{ count: 70 }, { count: 50 }, { count: 40 }],
});
creatureValidate(mediumDad);

// === Large creatures (~500+ neurons) ===
const largeMum = new Creature(50, 20, {
  layers: [
    { count: 200 },
    { count: 150 },
    { count: 100 },
  ],
});
creatureValidate(largeMum);

const largeDad = new Creature(50, 20, {
  layers: [
    { count: 180 },
    { count: 160 },
    { count: 80 },
  ],
});
creatureValidate(largeDad);

console.log("=== Creature Sizes (Issue #1644) ===");
console.log(
  `Small:  ${smallMum.neurons.length} neurons, ${smallMum.synapses.length} synapses`,
);
console.log(
  `Medium: ${mediumMum.neurons.length} neurons, ${mediumMum.synapses.length} synapses`,
);
console.log(
  `Large:  ${largeMum.neurons.length} neurons, ${largeMum.synapses.length} synapses`,
);

// === Breeding crossover benchmarks ===
Deno.bench({
  name: "Offspring.breed: Small (~20 neurons)",
  group: "breed-crossover-allocation",
  baseline: true,
  fn() {
    Offspring.breed(smallMum, smallDad);
  },
});

Deno.bench({
  name: "Offspring.breed: Medium (~200 neurons)",
  group: "breed-crossover-allocation",
  fn() {
    Offspring.breed(mediumMum, mediumDad);
  },
});

Deno.bench({
  name: "Offspring.breed: Large (~500 neurons)",
  group: "breed-crossover-allocation",
  fn() {
    Offspring.breed(largeMum, largeDad);
  },
});
