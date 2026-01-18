import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { Creature } from "../src/Creature.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Mutation } from "../src/NEAT/Mutation.ts";

/**
 * Benchmark for mutation class instance caching performance.
 *
 * Issue #1103: Use WeakMap for Mutator instance caching to avoid recreation.
 *
 * This benchmark measures the performance improvement from caching mutation
 * class instances per creature using WeakMap. This reduces object allocations
 * during evolution.
 *
 * Expected benefits:
 * - ~90% reduction in mutation class allocations
 * - Reduced GC pressure during evolution
 * - WeakMap allows GC of unused creatures
 */

const config = createNeatConfig({
  mutation: Mutation.FFW,
  mutationRate: 1.0,
  mutationAmount: 3,
});
const mutator = new Mutator(config);

// Create creature for basic tests
const smallCreature = new Creature(3, 2, { layers: [{ count: 2 }] });

// Test individual getMutatorInstance calls
Deno.bench("getMutatorInstance: single call (cached hit)", () => {
  mutator.getMutatorInstance(smallCreature, Mutation.ADD_NODE.name);
});

Deno.bench("getMutatorInstance: 100 calls same creature (cached)", () => {
  for (let i = 0; i < 100; i++) {
    mutator.getMutatorInstance(smallCreature, Mutation.ADD_NODE.name);
  }
});

Deno.bench("getMutatorInstance: 1000 calls same creature (cached)", () => {
  for (let i = 0; i < 1000; i++) {
    mutator.getMutatorInstance(smallCreature, Mutation.ADD_NODE.name);
  }
});

// Benchmark multiple mutation types on same creature
Deno.bench("getMutatorInstance: all FFW mutation types x100", () => {
  for (let i = 0; i < 100; i++) {
    for (const mutation of Mutation.FFW) {
      mutator.getMutatorInstance(smallCreature, mutation.name);
    }
  }
});

// Simulate realistic mutation loop: population of creatures with multiple mutations each
const population: Creature[] = Array.from(
  { length: 100 },
  () => new Creature(5, 3, { layers: [{ count: 5 }] }),
);

Deno.bench(
  "getMutatorInstance: 100 creatures x 3 mutations each (realistic)",
  () => {
    for (const creature of population) {
      mutator.getMutatorInstance(creature, Mutation.MOD_WEIGHT.name);
      mutator.getMutatorInstance(creature, Mutation.MOD_BIAS.name);
      mutator.getMutatorInstance(creature, Mutation.ADD_NODE.name);
    }
  },
);

// Benchmark mutateCreature (which now uses caching internally)
Deno.bench("mutateCreature: small creature x10", () => {
  const creature = new Creature(3, 2, { layers: [{ count: 2 }] });
  for (let i = 0; i < 10; i++) {
    const method = mutator.selectMutationMethod(creature);
    mutator.mutateCreature(creature, method);
  }
});

Deno.bench("mutateCreature: medium creature x10", () => {
  const creature = new Creature(10, 5, { layers: [{ count: 20 }] });
  for (let i = 0; i < 10; i++) {
    const method = mutator.selectMutationMethod(creature);
    mutator.mutateCreature(creature, method);
  }
});

// Full mutation loop benchmark (simulating real evolution scenario)
Deno.bench("mutate: population of 50 creatures, mutationAmount=3", () => {
  // Create fresh population for each benchmark iteration
  const pop: Creature[] = Array.from(
    { length: 50 },
    () => new Creature(5, 3, { layers: [{ count: 5 }] }),
  );
  mutator.mutate(pop);
});

Deno.bench("mutate: population of 100 creatures, mutationAmount=3", () => {
  const pop: Creature[] = Array.from(
    { length: 100 },
    () => new Creature(5, 3, { layers: [{ count: 5 }] }),
  );
  mutator.mutate(pop);
});

// Benchmark to show allocation benefit: alternating between creatures
// With caching, this reuses instances; without caching, it would create new ones
Deno.bench("getMutatorInstance: alternating 10 creatures x100 calls", () => {
  const creatures = Array.from(
    { length: 10 },
    () => new Creature(5, 3, { layers: [{ count: 5 }] }),
  );
  for (let i = 0; i < 100; i++) {
    for (const creature of creatures) {
      mutator.getMutatorInstance(creature, Mutation.MOD_WEIGHT.name);
    }
  }
});
