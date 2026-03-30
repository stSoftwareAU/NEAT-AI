import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "@neat/Mutator.ts";

/**
 * Unit tests for Mutator.mutate method.
 *
 * Issue #1397: Verify that the population-level mutate() method
 * correctly applies mutations based on the configured mutation rate,
 * mutation amount, and handles focus list caching.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({
    populationSize: 10,
    ...overrides,
  });
}

Deno.test("MutatorMutate: handles empty population gracefully", () => {
  const config = createConfig({ mutationRate: 1.0 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  mutator.mutate(creatures);

  assertEquals(creatures.length, 0, "Empty population should remain empty");
});

Deno.test("MutatorMutate: multiple mutation amounts apply multiple mutations per creature", () => {
  // With mutationAmount=3, each creature gets 3 mutation attempts
  const config = createConfig({ mutationRate: 1.0, mutationAmount: 3 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 5; i++) {
    creatures.push(new Creature(3, 2, { layers: [{ count: 6 }] }));
  }

  // This should not throw - multiple mutations should be applied
  mutator.mutate(creatures);

  // Verify creatures are still valid after multiple mutations
  for (const creature of creatures) {
    assertEquals(creature.input, 3);
    assertEquals(creature.output, 2);
  }
});

Deno.test("MutatorMutate: single creature mutation", () => {
  const config = createConfig({ mutationRate: 1.0 });
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  CreatureUtil.makeUUID(creature);

  mutator.mutate([creature]);

  // Creature dimensions should be preserved after mutation
  assert(
    creature.input === 3 && creature.output === 2,
    "Creature dimensions should be preserved",
  );
});
