import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { Creature } from "../src/Creature.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Mutation } from "../src/NEAT/Mutation.ts";

/**
 * Benchmark for non-expansion candidate caching in mutation selection.
 *
 * Issue #2045: Cache non-expansion mutation candidates for large creatures.
 *
 * For large creatures (>= large threshold, default 300 neurons), the
 * selectMutationMethod() function filters candidates to exclude topology
 * expansion mutations (ADD_NODE, ADD_CONN). This benchmark measures the
 * performance of this filtering with cached vs uncached approaches.
 */

const config = createNeatConfig({
  mutation: Mutation.FFW,
  adaptiveMutationThresholds: {
    medium: 100,
    large: 300,
    largeTopologyWeight: 0.1,
  },
});
const mutator = new Mutator(config);

// Large creature (>= 300 neurons) — exercises the non-expansion candidate path
const largeCreature = new Creature(10, 5, {
  layers: [{ count: 150 }, { count: 150 }],
});

// Very large creature (500+ neurons) — as specified in the issue
const veryLargeCreature = new Creature(20, 10, {
  layers: [{ count: 250 }, { count: 250 }],
});

// Small creature (below thresholds) — for comparison baseline
const smallCreature = new Creature(3, 2, { layers: [{ count: 2 }] });

Deno.bench("selectMutationMethod: small creature (baseline) x1000", () => {
  for (let i = 0; i < 1000; i++) {
    mutator.selectMutationMethod(smallCreature);
  }
});

Deno.bench(
  "selectMutationMethod: large creature (300+ neurons) x1000",
  () => {
    for (let i = 0; i < 1000; i++) {
      mutator.selectMutationMethod(largeCreature);
    }
  },
);

Deno.bench(
  "selectMutationMethod: very large creature (500+ neurons) x1000",
  () => {
    for (let i = 0; i < 1000; i++) {
      mutator.selectMutationMethod(veryLargeCreature);
    }
  },
);

// Simulate real evolution loop: multiple mutations per creature
Deno.bench(
  "selectMutationMethod: large creature mutationAmount=5 x100 creatures",
  () => {
    for (let c = 0; c < 100; c++) {
      for (let m = 0; m < 5; m++) {
        mutator.selectMutationMethod(largeCreature);
      }
    }
  },
);

Deno.bench(
  "selectMutationMethod: very large creature mutationAmount=5 x100 creatures",
  () => {
    for (let c = 0; c < 100; c++) {
      for (let m = 0; m < 5; m++) {
        mutator.selectMutationMethod(veryLargeCreature);
      }
    }
  },
);
