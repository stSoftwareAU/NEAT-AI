import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Tests for caching non-expansion mutation candidates for large creatures.
 *
 * Issue #2045: The selectMutationMethod() function creates a new filtered array
 * of non-expansion candidates on every call for large creatures. Since the
 * candidate list for a given creature size category doesn't change, this
 * filtered result should be cached alongside the existing candidates cache.
 */

Deno.test(
  "NonExpansionCache: large creatures never select ADD_NODE/ADD_CONN from non-expansion path",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0, // Disable topology expansion completely
      },
    });
    const mutator = new Mutator(config);

    // Create a large creature (>= 300 neurons)
    const creature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });
    assert(
      creature.neurons.length >= 300,
      `Creature should have >= 300 neurons, has ${creature.neurons.length}`,
    );

    // With largeTopologyWeight=0, should never get ADD_NODE or ADD_CONN
    for (let i = 0; i < 1000; i++) {
      const method = mutator.selectMutationMethod(creature);
      assert(
        method.name !== Mutation.ADD_NODE.name &&
          method.name !== Mutation.ADD_CONN.name,
        `Should not select topology expansion mutation ${method.name} for large creature`,
      );
    }
  },
);

Deno.test(
  "NonExpansionCache: cached results are consistent across repeated calls",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1,
      },
    });
    const mutator = new Mutator(config);

    // Create a large creature
    const creature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });

    // Collect mutation distributions over two separate runs
    // Both should produce valid mutations from the same cached candidates
    const collectDistribution = (iterations: number) => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < iterations; i++) {
        const method = mutator.selectMutationMethod(creature);
        counts[method.name] = (counts[method.name] || 0) + 1;
      }
      return counts;
    };

    const dist1 = collectDistribution(5000);
    const dist2 = collectDistribution(5000);

    // Both distributions should have the same set of mutation types
    const types1 = new Set(Object.keys(dist1));
    const types2 = new Set(Object.keys(dist2));

    // All types from dist2 should appear in dist1 (with enough samples)
    for (const type of types2) {
      assert(
        types1.has(type),
        `Mutation type ${type} appeared in second run but not first`,
      );
    }
  },
);

Deno.test(
  "NonExpansionCache: cache invalidation works when cache is cleared",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0,
      },
    });
    const mutator = new Mutator(config);

    // Create a large creature
    const creature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });

    // First call populates cache
    const method1 = mutator.selectMutationMethod(creature);
    assertEquals(typeof method1.name, "string", "Should return valid mutation");

    // Clear cache
    mutator.clearMutationCache();

    // Second call should repopulate cache and still work
    const method2 = mutator.selectMutationMethod(creature);
    assertEquals(
      typeof method2.name,
      "string",
      "Should return valid mutation after cache clear",
    );

    // Both should be non-expansion mutations (largeTopologyWeight=0)
    assert(
      method1.name !== Mutation.ADD_NODE.name &&
        method1.name !== Mutation.ADD_CONN.name,
      `Pre-clear mutation should not be topology expansion: ${method1.name}`,
    );
    assert(
      method2.name !== Mutation.ADD_NODE.name &&
        method2.name !== Mutation.ADD_CONN.name,
      `Post-clear mutation should not be topology expansion: ${method2.name}`,
    );
  },
);

Deno.test(
  "NonExpansionCache: different creature sizes use separate cache entries",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0,
      },
    });
    const mutator = new Mutator(config);

    // Small creature — should still get topology expansion mutations
    const smallCreature = new Creature(3, 2, { layers: [{ count: 2 }] });
    assert(
      smallCreature.neurons.length < 100,
      `Small creature should have < 100 neurons`,
    );

    // Large creature — should never get topology expansion
    const largeCreature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });
    assert(
      largeCreature.neurons.length >= 300,
      `Large creature should have >= 300 neurons`,
    );

    // Interleave calls to both creatures
    let smallTopologyExpansion = 0;
    for (let i = 0; i < 1000; i++) {
      const smallMethod = mutator.selectMutationMethod(smallCreature);
      const largeMethod = mutator.selectMutationMethod(largeCreature);

      if (
        smallMethod.name === Mutation.ADD_NODE.name ||
        smallMethod.name === Mutation.ADD_CONN.name
      ) {
        smallTopologyExpansion++;
      }

      // Large creature should never get expansion mutations
      assert(
        largeMethod.name !== Mutation.ADD_NODE.name &&
          largeMethod.name !== Mutation.ADD_CONN.name,
        `Large creature should not get topology expansion: ${largeMethod.name}`,
      );
    }

    // Small creature should get some topology expansion mutations
    assert(
      smallTopologyExpansion > 0,
      "Small creature should occasionally get topology expansion mutations",
    );
  },
);

Deno.test(
  "NonExpansionCache: non-expansion candidates exclude only ADD_NODE and ADD_CONN",
  () => {
    // Use largeTopologyWeight=0.1 so 90% of the time we get weight/bias preference,
    // but the remaining 10% exercises the non-expansion fallback path.
    // With enough iterations, non-expansion structural mutations will appear.
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1,
      },
    });
    const mutator = new Mutator(config);

    // Create a large creature with hidden neurons
    const creature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });

    // Collect all mutation types selected over many iterations
    const selectedTypes = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const method = mutator.selectMutationMethod(creature);
      selectedTypes.add(method.name);
    }

    // Should include weight/bias mutations
    assert(
      selectedTypes.has(Mutation.MOD_WEIGHT.name),
      "Should select MOD_WEIGHT",
    );
    assert(
      selectedTypes.has(Mutation.MOD_BIAS.name),
      "Should select MOD_BIAS",
    );

    // Other structural mutations (SUB_NODE, SUB_CONN, SWAP_NODES, MOD_SQUASH)
    // should still appear via the non-expansion fallback path
    assert(
      selectedTypes.has(Mutation.SUB_NODE.name),
      "Should still select SUB_NODE (not a topology expansion mutation)",
    );
    assert(
      selectedTypes.has(Mutation.SUB_CONN.name),
      "Should still select SUB_CONN (not a topology expansion mutation)",
    );
  },
);
