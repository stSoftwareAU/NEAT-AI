import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";

/**
 * Tests for cached non-expansion mutation candidates.
 *
 * Issue #2125: Verify that the pre-computed nonExpansionCandidates field
 * in MutationCacheEntry correctly excludes topology expansion mutations
 * (ADD_NODE, ADD_CONN) and is reused across calls.
 */

Deno.test(
  "NonExpansionCache: large creatures never select expansion mutations via non-expansion path",
  () => {
    // Configure thresholds so our creature is "large"
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 5,
        large: 10,
        largeTopologyWeight: 0,
      },
    });
    const mutator = new Mutator(config);

    // Create a creature above the large threshold (3 input + 10 hidden + 2 output = 15)
    const creature = new Creature(3, 2, { layers: [{ count: 10 }] });
    assertEquals(
      creature.neurons.length,
      15,
      "Creature should have 15 neurons",
    );

    // With largeTopologyWeight=0, the non-expansion path should always be taken
    // for large creatures when the weight/bias preference check is not hit.
    // Run many iterations and verify no expansion mutations appear.
    const selectedNames = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const method = mutator.selectMutationMethod(creature);
      selectedNames.add(method.name);
    }

    // ADD_NODE and ADD_CONN are expansion mutations and should never be selected
    // when largeTopologyWeight is 0
    assert(
      !selectedNames.has(Mutation.ADD_NODE.name),
      "ADD_NODE should not be selected for large creatures with largeTopologyWeight=0",
    );
    assert(
      !selectedNames.has(Mutation.ADD_CONN.name),
      "ADD_CONN should not be selected for large creatures with largeTopologyWeight=0",
    );

    // Non-expansion mutations should still appear
    assert(
      selectedNames.has(Mutation.MOD_WEIGHT.name),
      "MOD_WEIGHT should be available",
    );
    assert(
      selectedNames.has(Mutation.MOD_BIAS.name),
      "MOD_BIAS should be available",
    );
  },
);

Deno.test(
  "NonExpansionCache: cached non-expansion candidates are consistent across calls",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 5,
        large: 10,
        largeTopologyWeight: 0,
      },
    });
    const mutator = new Mutator(config);

    const creature = new Creature(3, 2, { layers: [{ count: 10 }] });

    // First batch of calls populates the cache
    const firstBatch = new Set<string>();
    for (let i = 0; i < 500; i++) {
      firstBatch.add(mutator.selectMutationMethod(creature).name);
    }

    // Second batch should produce the same set of mutation names
    const secondBatch = new Set<string>();
    for (let i = 0; i < 500; i++) {
      secondBatch.add(mutator.selectMutationMethod(creature).name);
    }

    // The mutation name sets should be identical (cache is stable)
    assertEquals(
      [...firstBatch].sort(),
      [...secondBatch].sort(),
      "Cached non-expansion candidates should produce consistent results",
    );
  },
);

Deno.test(
  "NonExpansionCache: different creature sizes produce correct cache entries",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 5,
        large: 10,
        largeTopologyWeight: 0,
      },
    });
    const mutator = new Mutator(config);

    // Small creature (below medium threshold) - expansion mutations allowed
    const smallCreature = new Creature(2, 1, { layers: [{ count: 1 }] });
    // Large creature (above large threshold) - expansion mutations excluded
    const largeCreature = new Creature(3, 2, { layers: [{ count: 10 }] });

    const smallNames = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      smallNames.add(mutator.selectMutationMethod(smallCreature).name);
    }

    const largeNames = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      largeNames.add(mutator.selectMutationMethod(largeCreature).name);
    }

    // Small creature should have expansion mutations available
    assert(
      smallNames.has(Mutation.ADD_NODE.name) ||
        smallNames.has(Mutation.ADD_CONN.name),
      "Small creatures should have expansion mutations available",
    );

    // Large creature should NOT have expansion mutations
    assert(
      !largeNames.has(Mutation.ADD_NODE.name),
      "Large creatures should not select ADD_NODE with largeTopologyWeight=0",
    );
    assert(
      !largeNames.has(Mutation.ADD_CONN.name),
      "Large creatures should not select ADD_CONN with largeTopologyWeight=0",
    );
  },
);

Deno.test(
  "NonExpansionCache: clearMutationCache resets non-expansion candidates",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 5,
        large: 10,
        largeTopologyWeight: 0,
      },
    });
    const mutator = new Mutator(config);

    const creature = new Creature(3, 2, { layers: [{ count: 10 }] });

    // Populate cache
    for (let i = 0; i < 100; i++) {
      mutator.selectMutationMethod(creature);
    }

    // Clear cache
    mutator.clearMutationCache();

    // Should still work correctly after cache clear
    const selectedNames = new Set<string>();
    for (let i = 0; i < 500; i++) {
      selectedNames.add(mutator.selectMutationMethod(creature).name);
    }

    // Non-expansion candidates should still be correctly filtered
    assert(
      !selectedNames.has(Mutation.ADD_NODE.name),
      "ADD_NODE should not appear after cache clear for large creatures",
    );
    assert(
      selectedNames.has(Mutation.MOD_WEIGHT.name),
      "MOD_WEIGHT should be available after cache clear",
    );
  },
);
