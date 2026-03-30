import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { Creature } from "../src/Creature.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Mutation } from "@neat/Mutation.ts";

/**
 * Benchmark for Issue #1583: Batch fix() and validate() calls.
 *
 * Measures the performance of the mutation loop (Mutator.mutate) with
 * varying mutationAmount values. The optimisation defers fix() and
 * validate() to after the entire mutation loop rather than calling
 * them per-mutation.
 */

// Configuration with high mutation rate to ensure all creatures are mutated.
const config3 = createNeatConfig({
  mutation: Mutation.FFW,
  mutationRate: 1.0,
  mutationAmount: 3,
});

const config5 = createNeatConfig({
  mutation: Mutation.FFW,
  mutationRate: 1.0,
  mutationAmount: 5,
});

const config10 = createNeatConfig({
  mutation: Mutation.FFW,
  mutationRate: 1.0,
  mutationAmount: 10,
});

const mutator3 = new Mutator(config3);
const mutator5 = new Mutator(config5);
const mutator10 = new Mutator(config10);

Deno.bench(
  "mutate: 50 creatures, mutationAmount=3",
  () => {
    const pop: Creature[] = Array.from(
      { length: 50 },
      () => new Creature(5, 3, { layers: [{ count: 5 }] }),
    );
    mutator3.mutate(pop);
  },
);

Deno.bench(
  "mutate: 50 creatures, mutationAmount=5",
  () => {
    const pop: Creature[] = Array.from(
      { length: 50 },
      () => new Creature(5, 3, { layers: [{ count: 5 }] }),
    );
    mutator5.mutate(pop);
  },
);

Deno.bench(
  "mutate: 50 creatures, mutationAmount=10",
  () => {
    const pop: Creature[] = Array.from(
      { length: 50 },
      () => new Creature(5, 3, { layers: [{ count: 5 }] }),
    );
    mutator10.mutate(pop);
  },
);

// Larger creatures benefit more from batching due to costlier fix/validate.
Deno.bench(
  "mutate: 20 large creatures, mutationAmount=5",
  () => {
    const pop: Creature[] = Array.from(
      { length: 20 },
      () => new Creature(10, 5, { layers: [{ count: 20 }] }),
    );
    mutator5.mutate(pop);
  },
);

Deno.bench(
  "mutate: 20 large creatures, mutationAmount=10",
  () => {
    const pop: Creature[] = Array.from(
      { length: 20 },
      () => new Creature(10, 5, { layers: [{ count: 20 }] }),
    );
    mutator10.mutate(pop);
  },
);
