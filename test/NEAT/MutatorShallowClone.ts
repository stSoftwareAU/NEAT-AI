import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import type { MemeticInterface } from "../../src/blackbox/MemeticInterface.ts";

/**
 * Tests for Issue #1586: Verify that using shallowClone in Mutator.mutate()
 * preserves all necessary properties for memetic updates and discovery.
 *
 * These tests ensure the shallowClone replacement for JSON serialisation
 * produces correct behaviour during mutation.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({
    populationSize: 10,
    ...overrides,
  });
}

Deno.test("MutatorShallowClone: mutating creature with score preserves behaviour", () => {
  const config = createConfig({ mutationRate: 1.0 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 5; i++) {
    const c = new Creature(3, 2, { layers: [{ count: 4 }] });
    c.score = 0.85 - i * 0.1;
    c.memetic = {
      generation: i + 1,
      weights: {},
      biases: {},
      score: 0.7,
    };
    creatures.push(c);
  }

  mutator.mutate(creatures);

  // Creatures should still be structurally valid after mutation
  for (const creature of creatures) {
    assertEquals(creature.input, 3, "Input should be preserved");
    assertEquals(creature.output, 2, "Output should be preserved");
    assert(
      creature.neurons.length >= creature.input + creature.output,
      "Should have at least input + output neurons",
    );
  }
});

Deno.test("MutatorShallowClone: mutating creature with memetic data works correctly", () => {
  const config = createConfig({ mutationRate: 1.0 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 3; i++) {
    const c = new Creature(3, 2, { layers: [{ count: 4 }] });
    c.score = 0.7;

    const memetic: MemeticInterface = {
      generation: i + 1,
      weights: {},
      biases: {},
      score: 0.6,
    };
    c.memetic = memetic;
    creatures.push(c);
  }

  // Should not throw - shallowClone handles memetic data correctly
  mutator.mutate(creatures);

  // Creatures should still be valid after mutation
  for (const creature of creatures) {
    assertEquals(creature.input, 3);
    assertEquals(creature.output, 2);
  }
});

Deno.test("MutatorShallowClone: shallowClone preserves score for original backup", () => {
  // Verify that shallowClone copies score (unlike the old approach that
  // needed a separate `original.score = creature.score` assignment)
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  creature.score = 0.95;

  const clone = creature.shallowClone();

  assertEquals(
    clone.score,
    0.95,
    "shallowClone should preserve the score property",
  );
});

Deno.test("MutatorShallowClone: shallowClone preserves memetic data for original backup", () => {
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  creature.score = 0.8;
  creature.memetic = {
    generation: 5,
    weights: {},
    biases: {},
    score: 0.7,
  };

  const clone = creature.shallowClone();

  assert(clone.memetic !== undefined, "shallowClone should preserve memetic");
  assertEquals(clone.memetic!.generation, 5);
  assertEquals(clone.memetic!.score, 0.7);
});

Deno.test("MutatorShallowClone: shallowClone produces structurally equivalent creature", () => {
  const creature = new Creature(5, 3, { layers: [{ count: 10 }] });
  creature.score = 0.42;

  const jsonClone = Creature.fromJSON(creature.exportJSON());
  jsonClone.score = creature.score;

  const shallowCloneResult = creature.shallowClone();

  // Both clones should have the same structure
  assertEquals(
    shallowCloneResult.neurons.length,
    jsonClone.neurons.length,
    "Neuron count should match",
  );
  assertEquals(
    shallowCloneResult.synapses.length,
    jsonClone.synapses.length,
    "Synapse count should match",
  );
  assertEquals(
    shallowCloneResult.input,
    jsonClone.input,
    "Input count should match",
  );
  assertEquals(
    shallowCloneResult.output,
    jsonClone.output,
    "Output count should match",
  );
  assertEquals(
    shallowCloneResult.score,
    jsonClone.score,
    "Score should match",
  );

  // Both clones should produce the same UUID (i.e. same topology)
  const jsonUUID = CreatureUtil.makeUUID(jsonClone);
  const shallowUUID = CreatureUtil.makeUUID(shallowCloneResult);
  assertEquals(
    shallowUUID,
    jsonUUID,
    "shallowClone and JSON clone should produce the same UUID",
  );
});
