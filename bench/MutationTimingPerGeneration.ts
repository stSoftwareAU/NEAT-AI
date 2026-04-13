/**
 * Benchmark for mutation timing per generation across population sizes.
 *
 * Issue #2279: Measure mutation time per generation for populations of
 * 100, 300, 500 creatures at various creature sizes to evaluate whether
 * parallelisation would be beneficial.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/MutationTimingPerGeneration.ts
 */
import { Creature } from "@creature";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";

const config = createNeatConfig({
  mutation: Mutation.FFW,
  mutationRate: 1.0,
  mutationAmount: 5,
});

const mutator = new Mutator(config);

/**
 * Creates a population of creatures with the specified dimensions.
 */
function createPopulation(
  count: number,
  inputs: number,
  outputs: number,
  hiddenPerLayer: number,
): Creature[] {
  return Array.from(
    { length: count },
    () =>
      new Creature(inputs, outputs, {
        layers: [{ count: hiddenPerLayer }],
      }),
  );
}

// ============================================
// Small creatures (5 inputs, 3 outputs, 5 hidden)
// ============================================

Deno.bench({
  name: "mutate: 100 small creatures (5→5→3)",
  group: "small creatures",
  baseline: true,
  fn() {
    const pop = createPopulation(100, 5, 3, 5);
    mutator.mutate(pop);
  },
});

Deno.bench({
  name: "mutate: 300 small creatures (5→5→3)",
  group: "small creatures",
  fn() {
    const pop = createPopulation(300, 5, 3, 5);
    mutator.mutate(pop);
  },
});

Deno.bench({
  name: "mutate: 500 small creatures (5→5→3)",
  group: "small creatures",
  fn() {
    const pop = createPopulation(500, 5, 3, 5);
    mutator.mutate(pop);
  },
});

// ============================================
// Medium creatures (10 inputs, 5 outputs, 20 hidden)
// ============================================

Deno.bench({
  name: "mutate: 100 medium creatures (10→20→5)",
  group: "medium creatures",
  baseline: true,
  fn() {
    const pop = createPopulation(100, 10, 5, 20);
    mutator.mutate(pop);
  },
});

Deno.bench({
  name: "mutate: 300 medium creatures (10→20→5)",
  group: "medium creatures",
  fn() {
    const pop = createPopulation(300, 10, 5, 20);
    mutator.mutate(pop);
  },
});

Deno.bench({
  name: "mutate: 500 medium creatures (10→20→5)",
  group: "medium creatures",
  fn() {
    const pop = createPopulation(500, 10, 5, 20);
    mutator.mutate(pop);
  },
});

// ============================================
// Large creatures (20 inputs, 10 outputs, 50 hidden)
// ============================================

Deno.bench({
  name: "mutate: 100 large creatures (20→50→10)",
  group: "large creatures",
  baseline: true,
  fn() {
    const pop = createPopulation(100, 20, 10, 50);
    mutator.mutate(pop);
  },
});

Deno.bench({
  name: "mutate: 300 large creatures (20→50→10)",
  group: "large creatures",
  fn() {
    const pop = createPopulation(300, 20, 10, 50);
    mutator.mutate(pop);
  },
});

Deno.bench({
  name: "mutate: 500 large creatures (20→50→10)",
  group: "large creatures",
  fn() {
    const pop = createPopulation(500, 20, 10, 50);
    mutator.mutate(pop);
  },
});
