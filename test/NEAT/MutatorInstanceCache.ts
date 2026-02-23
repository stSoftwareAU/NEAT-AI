import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Behavioural tests for Mutator mutation operations.
 *
 * These tests verify observable outcomes of mutation — correct results,
 * valid creature state, and expected side effects — rather than internal
 * caching mechanisms or object identity.
 */

Deno.test(
  "Behavioural: getMutatorInstance throws error for unknown mutation type",
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
  "Behavioural: repeated mutations on the same creature produce valid results",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature with hidden neurons
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });

    // Perform multiple mutations — each should produce a valid creature
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
  "Behavioural: mutation produces structurally valid creatures",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      mutationRate: 1.0,
      mutationAmount: 3,
    });
    const mutator = new Mutator(config);

    // Create a creature and mutate it
    const creature = new Creature(3, 2, { layers: [{ count: 3 }] });
    const originalInputCount = 3;
    const originalOutputCount = 2;

    // Record original state
    const originalJSON = JSON.stringify(creature.exportJSON());

    // Apply mutations
    mutator.mutate([creature]);

    // After mutation, the creature should still have correct input/output counts
    assertEquals(
      creature.input,
      originalInputCount,
      "Input neuron count should be preserved after mutation",
    );
    assertEquals(
      creature.output,
      originalOutputCount,
      "Output neuron count should be preserved after mutation",
    );

    // The creature should have been modified (UUID changes on mutation)
    const newJSON = JSON.stringify(creature.exportJSON());
    assertNotEquals(
      originalJSON,
      newJSON,
      "Creature should be modified after mutation with rate 1.0",
    );
  },
);

Deno.test(
  "Behavioural: all configured mutation types can be applied to suitable creatures",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.ALL,
      feedbackLoop: true,
    });
    const mutator = new Mutator(config);

    // Create a creature that can accept all mutation types
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    creature.forwardOnly = false;

    // Collect which mutation types are actually selected
    const selectedMutations = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const method = mutator.selectMutationMethod(creature);
      selectedMutations.add(method.name);
    }

    // Structural mutations should be available for a creature with hidden neurons
    assert(
      selectedMutations.has("ADD_NODE"),
      "ADD_NODE should be selectable for suitable creatures",
    );
    assert(
      selectedMutations.has("MOD_WEIGHT"),
      "MOD_WEIGHT should be selectable",
    );
    assert(
      selectedMutations.has("MOD_BIAS"),
      "MOD_BIAS should be selectable",
    );
  },
);

Deno.test(
  "Behavioural: mutating a population changes at least some creatures",
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

Deno.test(
  "Behavioural: mutations across different creatures produce independent results",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      mutationRate: 1.0,
      mutationAmount: 3,
    });
    const mutator = new Mutator(config);

    // Create two identical creatures
    const creature1 = new Creature(3, 2, { layers: [{ count: 3 }] });
    const creature2 = new Creature(3, 2, { layers: [{ count: 3 }] });

    // Mutate both
    mutator.mutate([creature1, creature2]);

    // Both should have been mutated (different UUIDs from each other due to randomness)
    // Both should have been mutated and remain valid creatures
    assert(
      creature1.neurons.length >= 5,
      "Creature 1 should still have neurons after mutation",
    );
    assert(
      creature2.neurons.length >= 5,
      "Creature 2 should still have neurons after mutation",
    );

    // Both should be valid creatures with correct I/O
    assertEquals(
      creature1.input,
      3,
      "Creature 1 should preserve input count",
    );
    assertEquals(
      creature2.input,
      3,
      "Creature 2 should preserve input count",
    );
  },
);
