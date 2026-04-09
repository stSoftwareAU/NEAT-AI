import { assert, assertInstanceOf, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { SubNeuron } from "@mutate/SubNeuron.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import { SubConnection } from "@mutate/SubConnection.ts";
import { ModWeight } from "@mutate/ModWeight.ts";
import { ModBias } from "@mutate/ModBias.ts";
import { ModActivation as ModSquash } from "@mutate/ModSquash.ts";
import { AddSelfCon } from "@mutate/AddSelfCon.ts";
import { SubSelfCon } from "@mutate/SubSelfCon.ts";
import { AddBackCon } from "@mutate/AddBackCon.ts";
import { SubBackCon } from "@mutate/SubBackCon.ts";
import { SwapNeurons } from "@mutate/SwapNeurons.ts";

/**
 * Unit tests for the Mutator operator factory map.
 *
 * Issue #2220: Verify that the Map-based factory lookup correctly
 * instantiates all 12 mutation operators and throws for unknown methods.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({
    populationSize: 10,
    ...overrides,
  });
}

// ============================================================================
// Factory Map Instantiation
// ============================================================================

Deno.test("MutatorOperatorFactory: getMutatorInstance returns correct type for all mutation operators", () => {
  const config = createConfig();
  const mutator = new Mutator(config);
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });

  const expectedTypes: Array<[string, new (...args: never[]) => unknown]> = [
    [Mutation.ADD_NODE.name, AddNeuron],
    [Mutation.SUB_NODE.name, SubNeuron],
    [Mutation.ADD_CONN.name, AddConnection],
    [Mutation.SUB_CONN.name, SubConnection],
    [Mutation.MOD_WEIGHT.name, ModWeight],
    [Mutation.MOD_BIAS.name, ModBias],
    [Mutation.MOD_SQUASH.name, ModSquash],
    [Mutation.ADD_SELF_CONN.name, AddSelfCon],
    [Mutation.SUB_SELF_CONN.name, SubSelfCon],
    [Mutation.ADD_BACK_CONN.name, AddBackCon],
    [Mutation.SUB_BACK_CONN.name, SubBackCon],
    [Mutation.SWAP_NODES.name, SwapNeurons],
  ];

  for (const [name, expectedClass] of expectedTypes) {
    const instance = mutator.getMutatorInstance(creature, name);
    assertInstanceOf(
      instance,
      expectedClass,
      `Factory should produce ${expectedClass.name} for "${name}"`,
    );
  }
});

Deno.test("MutatorOperatorFactory: unknown method throws ValidationError", () => {
  const config = createConfig();
  const mutator = new Mutator(config);
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });

  assertThrows(
    () => mutator.getMutatorInstance(creature, "NONEXISTENT_METHOD"),
    ValidationError,
    "Unknown mutation method",
  );
});

Deno.test("MutatorOperatorFactory: getMutatorInstance caches instances per creature", () => {
  const config = createConfig();
  const mutator = new Mutator(config);
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });

  const first = mutator.getMutatorInstance(creature, Mutation.MOD_WEIGHT.name);
  const second = mutator.getMutatorInstance(creature, Mutation.MOD_WEIGHT.name);

  // Same creature + same method => same cached instance
  assert(
    first === second,
    "getMutatorInstance should return the same cached instance for the same creature and method",
  );
});

Deno.test("MutatorOperatorFactory: different creatures get separate instances", () => {
  const config = createConfig();
  const mutator = new Mutator(config);
  const creature1 = new Creature(3, 2, { layers: [{ count: 4 }] });
  const creature2 = new Creature(3, 2, { layers: [{ count: 4 }] });

  const instance1 = mutator.getMutatorInstance(
    creature1,
    Mutation.MOD_WEIGHT.name,
  );
  const instance2 = mutator.getMutatorInstance(
    creature2,
    Mutation.MOD_WEIGHT.name,
  );

  // Different creatures => different instances
  assert(
    instance1 !== instance2,
    "Different creatures should get separate operator instances",
  );
});

Deno.test("MutatorOperatorFactory: all Mutation.ALL entries are covered by factory", () => {
  const config = createConfig();
  const mutator = new Mutator(config);
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });

  // Every mutation in Mutation.ALL should produce an operator without throwing
  for (const mutation of Mutation.ALL) {
    const instance = mutator.getMutatorInstance(creature, mutation.name);
    assert(
      instance !== undefined,
      `Factory should produce an operator for "${mutation.name}"`,
    );
    assert(
      typeof instance.mutate === "function",
      `Operator for "${mutation.name}" should have a mutate method`,
    );
  }
});
