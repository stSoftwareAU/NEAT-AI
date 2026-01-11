import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { Creature } from "../src/Creature.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Mutation } from "../src/NEAT/Mutation.ts";

/**
 * Benchmark for mutation candidate caching performance.
 *
 * Issue #1028: Cache valid mutations between selection calls to avoid repeated filtering.
 *
 * This benchmark measures the performance improvement from caching filtered
 * mutation candidates, which avoids repeated calls to calculateMaxSynapses().
 */

const config = createNeatConfig({
  mutation: Mutation.FFW,
});
const mutator = new Mutator(config);

// Create a creature with hidden neurons so all mutation types are available
const smallCreature = new Creature(3, 2, { layers: [{ count: 2 }] });

// Create a larger creature where calculateMaxSynapses is more expensive
const largeCreature = new Creature(20, 10, { layers: [{ count: 50 }] });

Deno.bench("selectMutationMethod: small creature x1 (cached)", () => {
  mutator.selectMutationMethod(smallCreature);
});

Deno.bench("selectMutationMethod: small creature x100 (cached)", () => {
  for (let i = 0; i < 100; i++) {
    mutator.selectMutationMethod(smallCreature);
  }
});

Deno.bench("selectMutationMethod: small creature x1000 (cached)", () => {
  for (let i = 0; i < 1000; i++) {
    mutator.selectMutationMethod(smallCreature);
  }
});

Deno.bench("selectMutationMethod: large creature x1 (cached)", () => {
  mutator.selectMutationMethod(largeCreature);
});

Deno.bench("selectMutationMethod: large creature x100 (cached)", () => {
  for (let i = 0; i < 100; i++) {
    mutator.selectMutationMethod(largeCreature);
  }
});

Deno.bench("selectMutationMethod: large creature x1000 (cached)", () => {
  for (let i = 0; i < 1000; i++) {
    mutator.selectMutationMethod(largeCreature);
  }
});

// Benchmark simulating multiple creatures (tests cache reuse across creatures)
const creatures = [
  new Creature(3, 2, { layers: [{ count: 2 }] }),
  new Creature(5, 3, { layers: [{ count: 5 }] }),
  new Creature(10, 5, { layers: [{ count: 10 }] }),
  new Creature(15, 8, { layers: [{ count: 20 }] }),
];

Deno.bench(
  "selectMutationMethod: alternating 4 creatures x100 (cached)",
  () => {
    for (let i = 0; i < 100; i++) {
      mutator.selectMutationMethod(creatures[i % 4]);
    }
  },
);

Deno.bench(
  "selectMutationMethod: alternating 4 creatures x1000 (cached)",
  () => {
    for (let i = 0; i < 1000; i++) {
      mutator.selectMutationMethod(creatures[i % 4]);
    }
  },
);

// Benchmark cold cache (cache cleared before each iteration)
Deno.bench("selectMutationMethod: cold cache x100", () => {
  mutator.clearMutationCache();
  for (let i = 0; i < 100; i++) {
    mutator.selectMutationMethod(smallCreature);
  }
});

// Benchmark simulating real mutation loop: multiple mutations per creature
// In the real mutate() loop, mutationAmount mutations are applied per creature
Deno.bench(
  "selectMutationMethod: mutationAmount=5 per creature x20 creatures",
  () => {
    for (let c = 0; c < 20; c++) {
      const creature = creatures[c % 4];
      for (let m = 0; m < 5; m++) {
        mutator.selectMutationMethod(creature);
      }
    }
  },
);

// Benchmark demonstrating cache reuse across similar-structured creatures
// Many creatures in a population have identical structure (same neurons/synapses counts)
const sameStructureCreatures = Array.from(
  { length: 50 },
  () => new Creature(10, 5, { layers: [{ count: 10 }] }),
);

Deno.bench(
  "selectMutationMethod: 50 same-structure creatures x10 calls each",
  () => {
    for (const creature of sameStructureCreatures) {
      for (let m = 0; m < 10; m++) {
        mutator.selectMutationMethod(creature);
      }
    }
  },
);
