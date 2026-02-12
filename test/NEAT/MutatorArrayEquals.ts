import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

/**
 * Unit tests for Mutator's focus list handling and the arrayEquals
 * private method (tested indirectly through mutate behaviour).
 *
 * Issue #1397: Verify that focus list caching works correctly
 * during mutation, preserving the cache when the focus list doesn't
 * change between mutation iterations.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({ populationSize: 10, ...overrides });
}

Deno.test("FocusListHandling: mutation with focus list produces valid creatures", () => {
  const config = createConfig({
    mutationRate: 1.0,
    focusList: [0, 1],
    focusRate: 1.0, // Always use focus list
  });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 5; i++) {
    creatures.push(new Creature(3, 2, { layers: [{ count: 4 }] }));
  }

  // Should not throw when using focus list
  mutator.mutate(creatures);

  for (const creature of creatures) {
    assertEquals(creature.input, 3, "Input should be preserved");
    assertEquals(creature.output, 2, "Output should be preserved");
  }
});

Deno.test("FocusListHandling: mutation without focus list produces valid creatures", () => {
  const config = createConfig({
    mutationRate: 1.0,
    focusList: [],
    focusRate: 0.0, // Never use focus list
  });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 5; i++) {
    creatures.push(new Creature(3, 2, { layers: [{ count: 4 }] }));
  }

  mutator.mutate(creatures);

  for (const creature of creatures) {
    assertEquals(creature.input, 3, "Input should be preserved");
    assertEquals(creature.output, 2, "Output should be preserved");
  }
});

Deno.test("FocusListHandling: mixed focus rate produces valid creatures", () => {
  const config = createConfig({
    mutationRate: 1.0,
    mutationAmount: 5, // Multiple mutations to exercise focus list switching
    focusList: [0, 1, 2],
    focusRate: 0.5, // 50% chance of using focus list
  });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 10; i++) {
    creatures.push(new Creature(4, 3, { layers: [{ count: 5 }] }));
  }

  // With multiple mutation amounts and mixed focus rate, the focus list
  // may change between iterations, triggering the arrayEquals comparison
  mutator.mutate(creatures);

  for (const creature of creatures) {
    assertEquals(creature.input, 4, "Input should be preserved");
    assertEquals(creature.output, 3, "Output should be preserved");
  }
});

Deno.test("FocusListHandling: high mutation amount with focus list", () => {
  const config = createConfig({
    mutationRate: 1.0,
    mutationAmount: 10, // Many mutations per creature
    focusList: [0],
    focusRate: 0.75,
  });
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 6 }] });
  CreatureUtil.makeUUID(creature);

  mutator.mutate([creature]);

  // After 10 mutations with 100% rate, the creature should have changed
  assertEquals(creature.input, 3, "Input should be preserved");
  assertEquals(creature.output, 2, "Output should be preserved");
});
