import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

/**
 * Unit tests for Mutator mutation candidate computation.
 *
 * Issue #1397: Verify that selectMutationMethod correctly filters
 * mutations based on creature state and config, including forward-only
 * constraints, maximum node/connection limits, and adaptive behaviour.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({ populationSize: 10, ...overrides });
}

Deno.test("ComputeMutationCandidates: filters out back/self-conn for forward-only creatures", () => {
  const config = createConfig({ mutation: [...Mutation.ALL] });
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  creature.forwardOnly = true;

  // Run many selections to check that back/self-conn mutations never appear
  const selectedNames = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const method = mutator.selectMutationMethod(creature);
    selectedNames.add(method.name);
  }

  assert(
    !selectedNames.has("ADD_SELF_CONN"),
    "ADD_SELF_CONN should not be selected for forward-only creatures",
  );
  assert(
    !selectedNames.has("SUB_SELF_CONN"),
    "SUB_SELF_CONN should not be selected for forward-only creatures",
  );
  assert(
    !selectedNames.has("ADD_BACK_CONN"),
    "ADD_BACK_CONN should not be selected for forward-only creatures",
  );
  assert(
    !selectedNames.has("SUB_BACK_CONN"),
    "SUB_BACK_CONN should not be selected for forward-only creatures",
  );
});

Deno.test("ComputeMutationCandidates: filters out back/self-conn for semantic version 4.x", () => {
  const config = createConfig({ mutation: [...Mutation.ALL] });
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  creature.semanticVersion = "4.0.0";

  const selectedNames = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const method = mutator.selectMutationMethod(creature);
    selectedNames.add(method.name);
  }

  assert(
    !selectedNames.has("ADD_SELF_CONN"),
    "ADD_SELF_CONN should not be selected for 4.x creatures",
  );
  assert(
    !selectedNames.has("SUB_SELF_CONN"),
    "SUB_SELF_CONN should not be selected for 4.x creatures",
  );
  assert(
    !selectedNames.has("ADD_BACK_CONN"),
    "ADD_BACK_CONN should not be selected for 4.x creatures",
  );
  assert(
    !selectedNames.has("SUB_BACK_CONN"),
    "SUB_BACK_CONN should not be selected for 4.x creatures",
  );
});

Deno.test("ComputeMutationCandidates: filters SUB_NODE when no hidden neurons", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  // Creature with no hidden neurons (only input + output)
  const creature = new Creature(3, 2);

  const selectedNames = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const method = mutator.selectMutationMethod(creature);
    selectedNames.add(method.name);
  }

  assert(
    !selectedNames.has("SUB_NODE"),
    "SUB_NODE should not be selected when no hidden neurons exist",
  );
});

Deno.test("ComputeMutationCandidates: filters SWAP_NODES when insufficient hidden neurons", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  // Creature with only 1 hidden neuron (need at least 2 for swap)
  const creature = new Creature(3, 2, { layers: [{ count: 1 }] });

  const selectedNames = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const method = mutator.selectMutationMethod(creature);
    selectedNames.add(method.name);
  }

  assert(
    !selectedNames.has("SWAP_NODES"),
    "SWAP_NODES should not be selected with only 1 hidden neuron",
  );
});

Deno.test("ComputeMutationCandidates: filters ADD_NODE when at maximum nodes", () => {
  const config = createConfig({ maximumNumberOfNodes: 6 });
  const mutator = new Mutator(config);

  // Creature with 3 input + 2 output + 1 hidden = 6 neurons (at max)
  const creature = new Creature(3, 2, { layers: [{ count: 1 }] });

  const selectedNames = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const method = mutator.selectMutationMethod(creature);
    selectedNames.add(method.name);
  }

  assert(
    !selectedNames.has("ADD_NODE"),
    "ADD_NODE should not be selected when at maximum nodes",
  );
});

Deno.test("ComputeMutationCandidates: allows ADD_NODE when below maximum", () => {
  const config = createConfig({ maximumNumberOfNodes: 100 });
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });

  const selectedNames = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const method = mutator.selectMutationMethod(creature);
    selectedNames.add(method.name);
  }

  assert(
    selectedNames.has("ADD_NODE"),
    "ADD_NODE should be available when below maximum nodes",
  );
});

Deno.test("ComputeMutationCandidates: always returns a valid mutation method", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });

  for (let i = 0; i < 100; i++) {
    const method = mutator.selectMutationMethod(creature);
    assert(method !== undefined, "Should always return a method");
    assert(method.name !== undefined, "Method should have a name");
    assert(method.name.length > 0, "Method name should not be empty");
  }
});

Deno.test("ComputeMutationCandidates: MOD_WEIGHT and MOD_BIAS are always candidates", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  // Even a minimal creature should allow MOD_WEIGHT and MOD_BIAS
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });

  const selectedNames = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const method = mutator.selectMutationMethod(creature);
    selectedNames.add(method.name);
  }

  assert(
    selectedNames.has("MOD_WEIGHT"),
    "MOD_WEIGHT should be available",
  );
  assert(
    selectedNames.has("MOD_BIAS"),
    "MOD_BIAS should be available",
  );
});

Deno.test("ComputeMutationCandidates: cache is cleared properly", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });

  // Select a method to populate cache
  mutator.selectMutationMethod(creature);

  // Clear cache
  mutator.clearMutationCache();

  // Should still work after cache clear
  const method = mutator.selectMutationMethod(creature);
  assert(method !== undefined, "Should work after cache clear");
});
