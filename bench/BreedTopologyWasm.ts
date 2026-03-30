/**
 * Benchmark for breeding/crossover topology reconstruction.
 *
 * Issue #1632: Benchmark & investigate migrating breeding/crossover
 * topology reconstruction to Rust/WASM.
 *
 * Baseline measurements of Offspring.breed() at three network sizes:
 * - Small: ~20 neurons (typical minimal networks)
 * - Medium: ~200 neurons (moderate complexity)
 * - Large: ~1000+ neurons (production-scale networks)
 *
 * Results (Apple M4 Pro, Deno 2.7.1):
 *   Small  (~20 neurons, 84 synapses):     ~464 µs/iter
 *   Medium (~200 neurons, 8500 synapses):   ~48 ms/iter
 *   Large  (~1070 neurons, 222000 synapses): ~1.8 s/iter
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/BreedTopologyWasm.ts
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

// === Large creatures (~1000+ neurons) ===
const largeMum = new Creature(50, 20, {
  layers: [
    { count: 400 },
    { count: 300 },
    { count: 200 },
    { count: 100 },
  ],
});
creatureValidate(largeMum);

const largeDad = new Creature(50, 20, {
  layers: [
    { count: 350 },
    { count: 280 },
    { count: 220 },
    { count: 120 },
  ],
});
creatureValidate(largeDad);

console.log("=== Creature Sizes (Issue #1632) ===");
console.log(
  `Small:  ${smallMum.neurons.length} neurons, ${smallMum.synapses.length} synapses`,
);
console.log(
  `Medium: ${mediumMum.neurons.length} neurons, ${mediumMum.synapses.length} synapses`,
);
console.log(
  `Large:  ${largeMum.neurons.length} neurons, ${largeMum.synapses.length} synapses`,
);

// === TypeScript baseline benchmarks ===
Deno.bench({
  name: "Offspring.breed: Small (~20 neurons)",
  group: "breed-topology",
  baseline: true,
  fn() {
    Offspring.breed(smallMum, smallDad);
  },
});

Deno.bench({
  name: "Offspring.breed: Medium (~200 neurons)",
  group: "breed-topology",
  fn() {
    Offspring.breed(mediumMum, mediumDad);
  },
});

Deno.bench({
  name: "Offspring.breed: Large (~1000 neurons)",
  group: "breed-topology",
  fn() {
    Offspring.breed(largeMum, largeDad);
  },
});
