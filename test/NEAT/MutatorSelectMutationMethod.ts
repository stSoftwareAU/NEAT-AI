import { assertAlmostEquals, assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Tests for selectMutationMethod optimization.
 *
 * Issue #1009: Replace rejection sampling with weighted selection for performance.
 *
 * The optimized algorithm prefers weight/bias mutations 75% of the time:
 * - 75% of the time: select from weight/bias mutations (if available)
 * - 25% of the time: select uniformly from all candidates
 *
 * Mathematical derivation (for FFW with 2 weight/bias out of 8 total):
 * - P(weight/bias) = 0.75 * 1.0 + 0.25 * (2/8) = 0.75 + 0.0625 = 0.8125 (81.25%)
 * - P(other) = 0.25 * (6/8) = 0.1875 (18.75%)
 */

Deno.test(
  "selectMutationMethod: prefers weight/bias mutations approximately 81.25% of the time",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature with hidden neurons so all mutation types are available
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

    const iterations = 10_000;
    let weightBiasCount = 0;

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.MOD_BIAS.name ||
        method.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      }
    }

    const weightBiasRatio = weightBiasCount / iterations;

    // Expected: ~81.25% weight/bias mutations
    // (75% direct + 25% * 2/8 from uniform selection)
    // Allow some variance (±5%) for statistical sampling
    assertAlmostEquals(
      weightBiasRatio,
      0.8125,
      0.05,
      `Expected ~81.25% weight/bias mutations, got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );
  },
);

Deno.test(
  "selectMutationMethod: returns valid mutation when weight/bias not in candidates",
  () => {
    // Use only structural mutations (no MOD_WEIGHT or MOD_BIAS)
    const config = createNeatConfig({
      mutation: [
        Mutation.ADD_NODE,
        Mutation.SUB_NODE,
        Mutation.ADD_CONN,
        Mutation.SUB_CONN,
      ],
    });
    const mutator = new Mutator(config);

    // Create a creature with hidden neurons so structural mutations are available
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

    // Should still return a valid mutation even without weight/bias options
    for (let i = 0; i < 100; i++) {
      const method = mutator.selectMutationMethod(creature);
      const validMutations = [
        Mutation.ADD_NODE.name,
        Mutation.SUB_NODE.name,
        Mutation.ADD_CONN.name,
        Mutation.SUB_CONN.name,
      ];
      assertEquals(
        validMutations.includes(method.name),
        true,
        `Unexpected mutation: ${method.name}`,
      );
    }
  },
);

Deno.test(
  "selectMutationMethod: falls back to any mutation when weight/bias mutations exist but are filtered",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a minimal creature (no hidden neurons) - this filters out some mutations
    const creature = new Creature(2, 1);

    // Should still return valid mutations (SUB_NODE and SWAP_NODES get filtered out)
    for (let i = 0; i < 100; i++) {
      const method = mutator.selectMutationMethod(creature);
      assertEquals(
        typeof method.name,
        "string",
        "Should return a mutation method",
      );
    }
  },
);

Deno.test(
  "selectMutationMethod: statistical distribution across all mutation types",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature with hidden neurons
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

    const iterations = 10_000;
    const counts: Record<string, number> = {};

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      counts[method.name] = (counts[method.name] || 0) + 1;
    }

    // Verify weight/bias mutations together make up ~81.25%
    const weightBiasCount = (counts[Mutation.MOD_WEIGHT.name] || 0) +
      (counts[Mutation.MOD_BIAS.name] || 0);
    const weightBiasRatio = weightBiasCount / iterations;

    assertAlmostEquals(
      weightBiasRatio,
      0.8125,
      0.05,
      `Expected ~81.25% weight/bias mutations, got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );

    // Verify the remaining ~18.75% is distributed among other mutations
    const otherCount = iterations - weightBiasCount;
    const otherRatio = otherCount / iterations;

    assertAlmostEquals(
      otherRatio,
      0.1875,
      0.05,
      `Expected ~18.75% other mutations, got ${(otherRatio * 100).toFixed(1)}%`,
    );

    // All configured mutations should appear at least once
    for (const mutation of Mutation.FFW) {
      // Skip mutations that may be filtered by creature constraints
      if (
        mutation.name === Mutation.SUB_NODE.name ||
        mutation.name === Mutation.SWAP_NODES.name
      ) {
        continue;
      }
      assertEquals(
        (counts[mutation.name] || 0) > 0,
        true,
        `Mutation ${mutation.name} should appear at least once`,
      );
    }
  },
);
