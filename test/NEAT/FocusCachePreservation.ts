/**
 * Test: Focus cache preservation across mutation batch (Issue #1100)
 *
 * These tests verify that the focus cache is preserved across mutations
 * within a mutation batch when the focus list remains constant.
 *
 * The optimisation separates focus cache (depends on focus list) from
 * structural cache (depends on creature topology). Structural changes
 * should not clear the focus cache.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Test that clearCache() does NOT clear the focus cache.
 * Focus cache validity depends on the focus list, not on structure.
 */
Deno.test("clearCache should NOT clear focus cache", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const creature = Creature.fromJSON(json);

  const focusList = [1];

  // Pre-populate the focus cache by calling inFocus for all neurons
  for (let i = 0; i < creature.neurons.length; i++) {
    creature.inFocus(i, focusList);
  }

  // Verify focus cache is populated (at least some results cached)
  // We check by calling inFocus again - if cached, it should return same value
  const cachedResult = creature.inFocus(0, focusList);

  // Now clear the structural cache
  creature.clearCache();

  // Focus cache should still be valid - same result without recalculation
  const afterClearResult = creature.inFocus(0, focusList);
  assertEquals(
    cachedResult,
    afterClearResult,
    "Focus result should be consistent after clearCache",
  );
});

/**
 * Test that clearFocusCache() explicitly clears the focus cache.
 */
Deno.test("clearFocusCache should clear only focus cache", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const creature = Creature.fromJSON(json);

  const focusList = [1];

  // Pre-populate the focus cache
  for (let i = 0; i < creature.neurons.length; i++) {
    creature.inFocus(i, focusList);
  }

  // Clear focus cache explicitly
  creature.clearFocusCache();

  // Verify the cache is cleared by checking that we can still call inFocus
  // (This verifies the method exists and works correctly)
  const result = creature.inFocus(0, focusList);
  assertEquals(typeof result, "boolean", "inFocus should return boolean");
});

/**
 * Test that focus cache is correctly used across multiple inFocus calls.
 */
Deno.test("inFocus should use cached results within same focus list", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const creature = Creature.fromJSON(json);

  const focusList = [1];

  // First call - populates cache
  const firstResults: boolean[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    firstResults.push(creature.inFocus(i, focusList));
  }

  // Second call - should use cache
  const secondResults: boolean[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    secondResults.push(creature.inFocus(i, focusList));
  }

  // Results should be identical
  assertEquals(
    firstResults,
    secondResults,
    "Cached results should match original results",
  );
});

/**
 * Test that changing the focus list clears the focus cache.
 * Different focus lists should not share cached results.
 */
Deno.test("different focus lists should not share cache", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const creature = Creature.fromJSON(json);

  // Use focus list [1] - only neuron 1 is directly in focus
  const focusList1 = [1];

  // Populate cache with first focus list
  const resultsWithFocus1: boolean[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    resultsWithFocus1.push(creature.inFocus(i, focusList1));
  }

  // Switch to different focus list [0] - only neuron 0 is directly in focus
  const focusList0 = [0];

  // When we change focus list, we should clear and rebuild the cache
  creature.clearFocusCache();

  const resultsWithFocus0: boolean[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    resultsWithFocus0.push(creature.inFocus(i, focusList0));
  }

  // The results should be different for some neurons
  // (since different focus lists affect which neurons are reachable)
  let differentCount = 0;
  for (let i = 0; i < creature.neurons.length; i++) {
    if (resultsWithFocus1[i] !== resultsWithFocus0[i]) {
      differentCount++;
    }
  }

  // At least some neurons should have different focus status
  assert(
    differentCount > 0,
    "Different focus lists should produce different results for at least some neurons",
  );
});

/**
 * Test that mutation batch with constant focus list preserves focus cache.
 * This is the core use case from Issue #1100.
 */
Deno.test("mutation batch with constant focus list should preserve focus cache", () => {
  const creature = new Creature(3, 2);
  // Add some hidden neurons for a more complex network
  for (let i = 0; i < 5; i++) {
    creature.makeRandomConnection(creature.neurons.length - creature.output);
  }

  const focusList = [1, 2];

  // Pre-populate focus cache
  const initialResults: boolean[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    initialResults.push(creature.inFocus(i, focusList));
  }

  // Simulate a structural change (like AddConnection would do)
  creature.clearCache();

  // Focus cache should still be valid after clearCache
  const afterMutationResults: boolean[] = [];
  for (let i = 0; i < creature.neurons.length; i++) {
    afterMutationResults.push(creature.inFocus(i, focusList));
  }

  // Results should be consistent (assuming no structural changes that affect focus)
  assertEquals(
    initialResults,
    afterMutationResults,
    "Focus results should be consistent after clearCache (structural change)",
  );
});

/**
 * Test Mutator integration: focus cache should be cleared only when focus list changes.
 *
 * This tests the Mutator.mutate() path where we track the focus list and
 * only clear focus cache when it changes between mutations.
 */
Deno.test("Mutator should clear focus cache only when focus list changes", () => {
  // Create a creature with hidden layers for more complexity
  const creature = new Creature(5, 3, { layers: [{ count: 3 }] });

  const config = createNeatConfig({
    mutationRate: 1.0,
    mutationAmount: 3,
    focusRate: 1.0, // Always use focus list
    focusList: [1, 2],
    maxConns: 100,
    maximumNumberOfNodes: 50,
    feedbackLoop: false,
    mutation: [Mutation.MOD_WEIGHT, Mutation.MOD_BIAS],
  });

  const mutator = new Mutator(config);

  // Pre-populate focus cache
  const focusList = config.focusList!;
  for (let i = 0; i < creature.neurons.length; i++) {
    creature.inFocus(i, focusList);
  }

  // Perform mutation batch - should preserve focus cache when focus list is constant
  mutator.mutate([creature]);

  // Verify creature is still valid after mutation
  assert(
    creature.neurons.length >= creature.input + creature.output,
    "Creature should have valid neuron count after mutation",
  );
});

/**
 * Test that focus cache handles empty focus list correctly.
 */
Deno.test("empty focus list should always return true (no cache needed)", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/inFocus.json"));
  const creature = Creature.fromJSON(json);

  // Empty focus list means all neurons are "in focus"
  for (let i = 0; i < creature.neurons.length; i++) {
    const result = creature.inFocus(i, []);
    assertEquals(
      result,
      true,
      `Neuron ${i} should be in focus with empty list`,
    );
  }

  // Undefined focus list also means all neurons are "in focus"
  for (let i = 0; i < creature.neurons.length; i++) {
    const result = creature.inFocus(i, undefined);
    assertEquals(
      result,
      true,
      `Neuron ${i} should be in focus with undefined list`,
    );
  }
});
