import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import { ValidationError } from "@errors/ValidationError.ts";

/**
 * Issue #2220: Tests for the factory map-based operator creation in Mutator.
 *
 * Verifies that all 12 mutation operators are correctly instantiated via
 * the map lookup, and that unknown method names throw a ValidationError.
 */

function createTestCreature(): Creature {
  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  CreatureUtil.makeUUID(creature);
  return creature;
}

// ============================================================================
// All mutation operators instantiate correctly via getMutatorInstance
// ============================================================================

Deno.test("MutatorOperatorFactory: all FFW operators instantiate via factory", () => {
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(config);
  const creature = createTestCreature();

  // All feed-forward mutation method names
  const ffw = Mutation.FFW;
  for (const method of ffw) {
    const instance = mutator.getMutatorInstance(creature, method.name);
    assertEquals(
      typeof instance.mutate,
      "function",
      `Operator for ${method.name} should have a mutate method`,
    );
  }
});

Deno.test("MutatorOperatorFactory: all ALL operators instantiate via factory", () => {
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(config);
  const creature = createTestCreature();

  // All mutation method names including recurrent
  const all = Mutation.ALL;
  for (const method of all) {
    const instance = mutator.getMutatorInstance(creature, method.name);
    assertEquals(
      typeof instance.mutate,
      "function",
      `Operator for ${method.name} should have a mutate method`,
    );
  }
});

// ============================================================================
// Unknown method name throws ValidationError
// ============================================================================

Deno.test("MutatorOperatorFactory: unknown method throws ValidationError", () => {
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(config);
  const creature = createTestCreature();

  const error = assertThrows(
    () => mutator.getMutatorInstance(creature, "NONEXISTENT_MUTATION"),
    ValidationError,
  );
  assertEquals(
    error.message.includes("Unknown mutation method"),
    true,
    "Error message should contain 'Unknown mutation method'",
  );
  assertEquals(
    error.message.includes("NONEXISTENT_MUTATION"),
    true,
    "Error message should contain the unknown method name",
  );
});

// ============================================================================
// Cached instances are reused
// ============================================================================

Deno.test("MutatorOperatorFactory: cached instances are reused for same creature", () => {
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(config);
  const creature = createTestCreature();

  const first = mutator.getMutatorInstance(creature, Mutation.MOD_WEIGHT.name);
  const second = mutator.getMutatorInstance(creature, Mutation.MOD_WEIGHT.name);

  // Should be the exact same object reference (cached)
  assertEquals(
    first === second,
    true,
    "Cached operator instance should be reused for the same creature and method",
  );
});

Deno.test("MutatorOperatorFactory: different creatures get different instances", () => {
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(config);
  const creature1 = createTestCreature();
  const creature2 = createTestCreature();

  const inst1 = mutator.getMutatorInstance(creature1, Mutation.MOD_WEIGHT.name);
  const inst2 = mutator.getMutatorInstance(creature2, Mutation.MOD_WEIGHT.name);

  // Different creatures should get different instances
  assertEquals(
    inst1 !== inst2,
    true,
    "Different creatures should get different operator instances",
  );
});
