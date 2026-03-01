/**
 * Benchmark for creature construction overhead profiling.
 *
 * Issue #1643: Profile and reduce creature construction overhead.
 *
 * Breaks down creature construction time into components:
 * - Fresh construction via `new Creature(input, output, options)`
 * - Reconstruction from JSON via `Creature.fromJSON()`
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/CreatureConstruction.ts
 */
import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";

// Pre-build creatures for fromJSON benchmarks
const smallCreature = new Creature(5, 3, {
  layers: [{ count: 10 }, { count: 5 }],
});
creatureValidate(smallCreature);
const smallJSON = smallCreature.exportJSON();

const mediumCreature = new Creature(20, 10, {
  layers: [{ count: 50 }, { count: 30 }],
});
creatureValidate(mediumCreature);
const mediumJSON = mediumCreature.exportJSON();

const largeCreature = new Creature(50, 20, {
  layers: [
    { count: 200 },
    { count: 150 },
    { count: 100 },
  ],
});
creatureValidate(largeCreature);
const largeJSON = largeCreature.exportJSON();

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

// === Fresh Construction Benchmarks ===

Deno.bench({
  name: "Small fresh construction (5→10→5→3)",
  group: "Fresh construction",
  baseline: true,
  fn() {
    new Creature(5, 3, {
      layers: [{ count: 10 }, { count: 5 }],
    });
  },
});

Deno.bench({
  name: "Medium fresh construction (20→50→30→10)",
  group: "Fresh construction",
  fn() {
    new Creature(20, 10, {
      layers: [{ count: 50 }, { count: 30 }],
    });
  },
});

Deno.bench({
  name: "Large fresh construction (50→200→150→100→20)",
  group: "Fresh construction",
  fn() {
    new Creature(50, 20, {
      layers: [
        { count: 200 },
        { count: 150 },
        { count: 100 },
      ],
    });
  },
});

// === fromJSON Reconstruction Benchmarks ===

Deno.bench({
  name: "Small fromJSON (18 neurons)",
  group: "fromJSON reconstruction",
  baseline: true,
  fn() {
    Creature.fromJSON(smallJSON);
  },
});

Deno.bench({
  name: "Medium fromJSON (110 neurons)",
  group: "fromJSON reconstruction",
  fn() {
    Creature.fromJSON(mediumJSON);
  },
});

Deno.bench({
  name: "Large fromJSON (520 neurons)",
  group: "fromJSON reconstruction",
  fn() {
    Creature.fromJSON(largeJSON);
  },
});
