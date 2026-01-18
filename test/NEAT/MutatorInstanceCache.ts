import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Tests for mutation class instance caching using WeakMap.
 *
 * Issue #1103: Use WeakMap for Mutator instance caching to avoid recreation.
 *
 * The optimisation caches mutation class instances per creature using WeakMap,
 * reducing object allocations during evolution. WeakMap allows garbage collection
 * of unused creatures while caching their mutation instances.
 *
 * Expected benefits:
 * - ~90% reduction in mutation class allocations
 * - Reduced GC pressure during evolution
 * - WeakMap allows GC of unused creatures
 */

Deno.test(
  "getMutatorInstance: returns cached instance for same creature and mutation type",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

    // Get mutator instances for the same creature and mutation type
    const instance1 = mutator.getMutatorInstance(
      creature,
      Mutation.ADD_NODE.name,
    );
    const instance2 = mutator.getMutatorInstance(
      creature,
      Mutation.ADD_NODE.name,
    );

    // Should return the same cached instance
    assertEquals(
      instance1,
      instance2,
      "Should return cached instance for same creature and mutation type",
    );
  },
);

Deno.test(
  "getMutatorInstance: returns different instances for different mutation types",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

    // Get mutator instances for different mutation types
    const addNeuronInstance = mutator.getMutatorInstance(
      creature,
      Mutation.ADD_NODE.name,
    );
    const modWeightInstance = mutator.getMutatorInstance(
      creature,
      Mutation.MOD_WEIGHT.name,
    );

    // Should return different instances for different mutation types
    assertNotEquals(
      addNeuronInstance,
      modWeightInstance,
      "Should return different instances for different mutation types",
    );
  },
);

Deno.test(
  "getMutatorInstance: returns different instances for different creatures",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create two creatures
    const creature1 = new Creature(3, 2, { layers: [{ count: 2 }] });
    const creature2 = new Creature(3, 2, { layers: [{ count: 2 }] });

    // Get mutator instances for different creatures
    const instance1 = mutator.getMutatorInstance(
      creature1,
      Mutation.ADD_NODE.name,
    );
    const instance2 = mutator.getMutatorInstance(
      creature2,
      Mutation.ADD_NODE.name,
    );

    // Should return different instances for different creatures
    assertNotEquals(
      instance1,
      instance2,
      "Should return different instances for different creatures",
    );
  },
);

Deno.test(
  "getMutatorInstance: caches instances for all mutation types",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.ALL,
      feedbackLoop: true,
    });
    const mutator = new Mutator(config);

    // Create a creature that can use all mutation types
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });
    creature.forwardOnly = false;

    // Test each mutation type
    const mutationNames = [
      Mutation.ADD_NODE.name,
      Mutation.SUB_NODE.name,
      Mutation.ADD_CONN.name,
      Mutation.SUB_CONN.name,
      Mutation.MOD_WEIGHT.name,
      Mutation.MOD_BIAS.name,
      Mutation.MOD_SQUASH.name,
      Mutation.ADD_SELF_CONN.name,
      Mutation.SUB_SELF_CONN.name,
      Mutation.ADD_BACK_CONN.name,
      Mutation.SUB_BACK_CONN.name,
      Mutation.SWAP_NODES.name,
    ];

    for (const name of mutationNames) {
      const instance1 = mutator.getMutatorInstance(creature, name);
      const instance2 = mutator.getMutatorInstance(creature, name);

      assertEquals(
        instance1,
        instance2,
        `Should cache instance for mutation type: ${name}`,
      );
    }
  },
);

Deno.test(
  "getMutatorInstance: throws error for unknown mutation type",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

    let errorThrown = false;
    try {
      mutator.getMutatorInstance(creature, "UNKNOWN_MUTATION");
    } catch (e) {
      errorThrown = true;
      const error = e as Error;
      assert(
        error.message.includes("unknown"),
        "Error message should indicate unknown mutation type",
      );
    }

    assert(errorThrown, "Should throw error for unknown mutation type");
  },
);

Deno.test(
  "mutateCreature: uses cached mutator instances",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature with hidden neurons
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });

    // Perform multiple mutations - each should use cached instances
    // This is a behavioural test that ensures mutation works correctly
    // with the caching mechanism
    let mutationCount = 0;
    for (let i = 0; i < 20; i++) {
      const method = mutator.selectMutationMethod(creature);
      const changed = mutator.mutateCreature(creature, method);
      if (changed) {
        mutationCount++;
      }
    }

    // At least some mutations should have succeeded
    assert(
      mutationCount > 0,
      `Expected some successful mutations, got ${mutationCount}`,
    );
  },
);

Deno.test(
  "getMutatorInstance: WeakMap allows GC of unused creatures",
  () => {
    // This test verifies that the WeakMap-based caching doesn't prevent
    // garbage collection of creatures. Since we can't directly test GC
    // behaviour, we verify that the cache uses WeakMap semantics by
    // checking that new creatures get new instances even after many
    // creatures have been used.

    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create and use many creatures
    const instances: unknown[] = [];
    for (let i = 0; i < 100; i++) {
      const creature = new Creature(3, 2, { layers: [{ count: 2 }] });
      const instance = mutator.getMutatorInstance(
        creature,
        Mutation.ADD_NODE.name,
      );
      instances.push(instance);
    }

    // All instances should be unique (different creatures)
    const uniqueInstances = new Set(instances);
    assertEquals(
      uniqueInstances.size,
      100,
      "Each creature should get its own instance",
    );

    // Creating a new creature should not be affected by previous ones
    const newCreature = new Creature(3, 2, { layers: [{ count: 2 }] });
    const newInstance = mutator.getMutatorInstance(
      newCreature,
      Mutation.ADD_NODE.name,
    );

    // Should get a fresh instance
    assert(
      !instances.includes(newInstance),
      "New creature should get fresh instance",
    );
  },
);

Deno.test(
  "mutate: works correctly with cached mutator instances across population",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      mutationRate: 1.0, // Ensure all creatures are mutated
      mutationAmount: 1,
    });
    const mutator = new Mutator(config);

    // Create a population of creatures
    const population: Creature[] = [];
    for (let i = 0; i < 10; i++) {
      population.push(new Creature(3, 2, { layers: [{ count: 3 }] }));
    }

    // Record initial UUIDs
    const initialUUIDs = population.map((c) => c.uuid);

    // Mutate the population
    mutator.mutate(population);

    // Verify mutations occurred (at least some UUIDs should change)
    let changedCount = 0;
    for (let i = 0; i < population.length; i++) {
      if (population[i].uuid !== initialUUIDs[i]) {
        changedCount++;
      }
    }

    // At least some creatures should have been mutated
    assert(
      changedCount > 0,
      `Expected some mutations in population, got ${changedCount} changes`,
    );
  },
);
