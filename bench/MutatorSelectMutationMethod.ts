import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { Creature } from "../src/Creature.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Mutation } from "../src/NEAT/Mutation.ts";

/**
 * Benchmark for selectMutationMethod performance.
 *
 * Issue #1009: The rejection sampling loop can iterate up to 10,000 times.
 * This benchmark measures the performance improvement from weighted selection.
 */

const config = createNeatConfig({
  mutation: Mutation.FFW,
});
const mutator = new Mutator(config);

// Create a creature with hidden neurons so all mutation types are available
const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

Deno.bench("selectMutationMethod", () => {
  mutator.selectMutationMethod(creature);
});

Deno.bench("selectMutationMethod x100", () => {
  for (let i = 0; i < 100; i++) {
    mutator.selectMutationMethod(creature);
  }
});

Deno.bench("selectMutationMethod x1000", () => {
  for (let i = 0; i < 1000; i++) {
    mutator.selectMutationMethod(creature);
  }
});
