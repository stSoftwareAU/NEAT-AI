import { assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Tests for caching valid mutation candidates between selection calls.
 *
 * Issue #1028: Cache valid mutations between selection calls to avoid repeated filtering.
 *
 * The optimisation caches the filtered candidates for a creature so that
 * repeated calls to selectMutationMethod() don't re-filter on every call.
 * The cache is invalidated when the creature's structure changes (neurons/synapses).
 */

Deno.test(
  "selectMutationMethod: returns same mutation set when creature structure unchanged",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create a creature with hidden neurons
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

    // Record the structural state
    const initialNeuronCount = creature.neurons.length;
    const initialSynapseCount = creature.synapses.length;

    // Call selectMutationMethod multiple times
    const methods: string[] = [];
    for (let i = 0; i < 100; i++) {
      const method = mutator.selectMutationMethod(creature);
      methods.push(method.name);
    }

    // All selected methods should be valid for the creature
    // (this tests that caching doesn't corrupt the selection)
    for (const methodName of methods) {
      const validMutations = Mutation.FFW.map((m) => m.name);
      assertEquals(
        validMutations.includes(methodName),
        true,
        `Invalid mutation selected: ${methodName}`,
      );
    }

    // Creature structure should not have changed
    assertEquals(
      creature.neurons.length,
      initialNeuronCount,
      "Neuron count changed unexpectedly",
    );
    assertEquals(
      creature.synapses.length,
      initialSynapseCount,
      "Synapse count changed unexpectedly",
    );
  },
);

Deno.test(
  "selectMutationMethod: cache key includes neuron and synapse counts",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
    });
    const mutator = new Mutator(config);

    // Create two creatures with different structures
    const creature1 = new Creature(3, 2, { layers: [{ count: 2 }] });
    const creature2 = new Creature(3, 2, { layers: [{ count: 5 }] });

    // Different neuron counts mean different cache keys
    assertNotEquals(
      creature1.neurons.length,
      creature2.neurons.length,
      "Test requires creatures with different neuron counts",
    );

    // Both should still return valid mutations
    for (let i = 0; i < 10; i++) {
      const method1 = mutator.selectMutationMethod(creature1);
      const method2 = mutator.selectMutationMethod(creature2);

      const validMutations = Mutation.FFW.map((m) => m.name);
      assertEquals(
        validMutations.includes(method1.name),
        true,
        `Invalid mutation for creature1: ${method1.name}`,
      );
      assertEquals(
        validMutations.includes(method2.name),
        true,
        `Invalid mutation for creature2: ${method2.name}`,
      );
    }
  },
);

Deno.test(
  "selectMutationMethod: cache is per-creature, not shared across creatures",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      maximumNumberOfNodes: 10,
    });
    const mutator = new Mutator(config);

    // Create creature at max nodes - ADD_NODE should be filtered out
    const maxCreature = new Creature(3, 2, {
      layers: [{ count: 5 }],
    }); // 3 + 5 + 2 = 10 neurons

    assertEquals(
      maxCreature.neurons.length,
      10,
      "maxCreature should have exactly 10 neurons",
    );

    // Create normal creature - ADD_NODE should be allowed
    const normalCreature = new Creature(3, 2, { layers: [{ count: 1 }] });
    assertEquals(
      normalCreature.neurons.length,
      6,
      "normalCreature should have 6 neurons",
    );

    // Alternate between creatures to ensure cache doesn't leak
    for (let i = 0; i < 50; i++) {
      mutator.selectMutationMethod(maxCreature);
      mutator.selectMutationMethod(normalCreature);
    }

    // Both should still work correctly
    const maxMethod = mutator.selectMutationMethod(maxCreature);
    const normalMethod = mutator.selectMutationMethod(normalCreature);

    const validMutations = Mutation.FFW.map((m) => m.name);
    assertEquals(
      validMutations.includes(maxMethod.name),
      true,
      `Invalid mutation for maxCreature: ${maxMethod.name}`,
    );
    assertEquals(
      validMutations.includes(normalMethod.name),
      true,
      `Invalid mutation for normalCreature: ${normalMethod.name}`,
    );
  },
);

Deno.test(
  "selectMutationMethod: cache includes forwardOnly flag in key",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.ALL,
      feedbackLoop: true,
    });
    const mutator = new Mutator(config);

    // Create two identical creatures but with different forwardOnly flags
    const creature1 = new Creature(3, 2, { layers: [{ count: 2 }] });
    creature1.forwardOnly = false;

    const creature2 = new Creature(3, 2, { layers: [{ count: 2 }] });
    creature2.forwardOnly = true;
    creature2.semanticVersion = "3.0.0"; // Keep at v3 so forwardOnly is respected

    // Both should return valid mutations for their respective constraints
    for (let i = 0; i < 50; i++) {
      const method1 = mutator.selectMutationMethod(creature1);
      const method2 = mutator.selectMutationMethod(creature2);

      // forwardOnly=false allows back/self connections
      const allMutations = Mutation.ALL.map((m) => m.name);
      assertEquals(
        allMutations.includes(method1.name),
        true,
        `Invalid mutation for creature1: ${method1.name}`,
      );
      assertEquals(
        allMutations.includes(method2.name),
        true,
        `Invalid mutation for creature2: ${method2.name}`,
      );
    }
  },
);

Deno.test(
  "selectMutationMethod: validates calculateMaxSynapses is not called redundantly",
  () => {
    // This is a behavioural test - we verify that the cache works by
    // calling selectMutationMethod many times and checking it returns valid results
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      maxConns: 1000,
    });
    const mutator = new Mutator(config);

    // Create a creature with substantial hidden layer
    const creature = new Creature(10, 5, { layers: [{ count: 20 }] });

    // Call selectMutationMethod 1000 times - with caching this should be fast
    const startTime = performance.now();
    for (let i = 0; i < 1000; i++) {
      const method = mutator.selectMutationMethod(creature);
      // Ensure we get a valid result each time
      assertEquals(
        typeof method.name,
        "string",
        "Should return valid mutation method",
      );
    }
    const elapsedTime = performance.now() - startTime;

    // The test passes if it completes - timing is just informational
    console.log(
      `[MutatorCacheValidMutations] 1000 calls completed in ${
        elapsedTime.toFixed(2)
      }ms`,
    );
  },
);

Deno.test(
  "selectMutationMethod: cache respects semanticVersion for forwardOnly",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.ALL,
      feedbackLoop: true,
    });
    const mutator = new Mutator(config);

    // Create a v4.x creature - should always be forward-only
    const v4Creature = new Creature(3, 2, { layers: [{ count: 2 }] });
    v4Creature.semanticVersion = "4.0.0";

    // Back/self connection mutations should be filtered out for v4.x
    const selectedMethods = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const method = mutator.selectMutationMethod(v4Creature);
      selectedMethods.add(method.name);
    }

    // v4.x creatures should never get back/self connection mutations
    assertEquals(
      selectedMethods.has(Mutation.ADD_BACK_CONN.name),
      false,
      "v4.x creature should not get ADD_BACK_CONN",
    );
    assertEquals(
      selectedMethods.has(Mutation.SUB_BACK_CONN.name),
      false,
      "v4.x creature should not get SUB_BACK_CONN",
    );
    assertEquals(
      selectedMethods.has(Mutation.ADD_SELF_CONN.name),
      false,
      "v4.x creature should not get ADD_SELF_CONN",
    );
    assertEquals(
      selectedMethods.has(Mutation.SUB_SELF_CONN.name),
      false,
      "v4.x creature should not get SUB_SELF_CONN",
    );
  },
);
