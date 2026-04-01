import { createNeatConfig } from "@config/NeatConfig.ts";
import { Creature } from "@creature";
import { Mutator } from "@neat/Mutator.ts";
import { Mutation } from "@neat/Mutation.ts";

/**
 * Benchmark for non-expansion mutation candidate caching.
 *
 * Issue #2125: Measures the performance of selectMutationMethod for large
 * creatures where the non-expansion candidate filtering path is exercised.
 * The optimisation pre-computes nonExpansionCandidates once per cache key
 * instead of filtering on every call.
 */

const config = createNeatConfig({
  mutation: Mutation.FFW,
  adaptiveMutationThresholds: {
    medium: 5,
    large: 10,
    largeTopologyWeight: 0.01,
  },
});
const mutator = new Mutator(config);

// Large creature that triggers non-expansion filtering path
const largeCreature = new Creature(10, 5, { layers: [{ count: 50 }] });

Deno.bench("selectMutationMethod (large creature, non-expansion path)", () => {
  mutator.selectMutationMethod(largeCreature);
});

Deno.bench(
  "selectMutationMethod x100 (large creature, non-expansion path)",
  () => {
    for (let i = 0; i < 100; i++) {
      mutator.selectMutationMethod(largeCreature);
    }
  },
);

Deno.bench(
  "selectMutationMethod x1000 (large creature, non-expansion path)",
  () => {
    for (let i = 0; i < 1000; i++) {
      mutator.selectMutationMethod(largeCreature);
    }
  },
);
