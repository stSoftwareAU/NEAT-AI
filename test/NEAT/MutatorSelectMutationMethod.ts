import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Behavioural tests for selectMutationMethod.
 *
 * These tests verify the observable statistical properties of mutation
 * selection — that weight/bias mutations dominate selection, and that
 * all configured mutation types can appear — without coupling to exact
 * internal list sizes or implementation constants.
 */

Deno.test(
  "Behavioural: selectMutationMethod strongly prefers weight/bias mutations",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature with hidden neurons so all FFW mutation types are available
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

    // Weight/bias mutations should clearly dominate (> 50% of selections)
    // The adaptive algorithm intentionally favours these for stability
    assert(
      weightBiasRatio > 0.5,
      `Expected weight/bias mutations to dominate (> 50%), got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );

    // But structural mutations should still appear (not 100% weight/bias)
    assert(
      weightBiasRatio < 0.99,
      `Expected some structural mutations to appear, but weight/bias was ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );
  },
);

Deno.test(
  "Behavioural: selectMutationMethod returns valid mutation when weight/bias not in candidates",
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
  "Behavioural: selectMutationMethod falls back gracefully for minimal creatures",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a minimal creature (no hidden neurons) — this filters out some mutations
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
  "Behavioural: selectMutationMethod exercises all configured non-structural mutations",
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

    // Weight/bias mutations should dominate overall
    const weightBiasCount = (counts[Mutation.MOD_WEIGHT.name] || 0) +
      (counts[Mutation.MOD_BIAS.name] || 0);
    const weightBiasRatio = weightBiasCount / iterations;

    assert(
      weightBiasRatio > 0.5,
      `Expected weight/bias to dominate, got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );

    // Non-structural mutations (weight/bias) should both appear
    assert(
      (counts[Mutation.MOD_WEIGHT.name] || 0) > 0,
      "MOD_WEIGHT should appear at least once",
    );
    assert(
      (counts[Mutation.MOD_BIAS.name] || 0) > 0,
      "MOD_BIAS should appear at least once",
    );

    // Structural mutations should also appear (at least some)
    const structuralMutations = Object.keys(counts).filter(
      (name) =>
        name !== Mutation.MOD_WEIGHT.name && name !== Mutation.MOD_BIAS.name,
    );
    assert(
      structuralMutations.length > 0,
      "At least some structural mutation types should appear",
    );
  },
);
