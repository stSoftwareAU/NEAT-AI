import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
} from "../../src/utils/RandomNumberGenerator.ts";

/**
 * Integration tests for Issue #1400: Reproducible random number generation.
 *
 * These tests verify that supplying a `seed` (or custom `rng`) in NeatOptions
 * makes the NEAT algorithm's stochastic operations deterministic and
 * reproducible.
 */

Deno.test("NeatConfig: seed option creates a seeded RNG", () => {
  const config = createNeatConfig({ seed: 42 });
  assertEquals(config.rng.seeded, true);
});

Deno.test("NeatConfig: seed option from string (CLI)", () => {
  const config = createNeatConfig({ seed: "42" });
  assertEquals(config.rng.seeded, true);
});

Deno.test("NeatConfig: no seed creates an unseeded RNG", () => {
  const config = createNeatConfig({});
  assertEquals(config.rng.seeded, false);
});

Deno.test("NeatConfig: custom rng takes precedence over seed", () => {
  const custom = createSeededRng(99);
  const config = createNeatConfig({ seed: 42, rng: custom });
  assertEquals(config.rng, custom);
});

Deno.test("NeatConfig: seed sets the global RNG", () => {
  createNeatConfig({ seed: 42 });
  const globalRng = getRandomNumberGenerator();
  assertEquals(globalRng.seeded, true);
});

Deno.test("NeatConfig: same seed produces identical config defaults", () => {
  // sparseRatio and globalBreedingRate use RNG when not explicitly set
  const config1 = createNeatConfig({ seed: 12345 });
  const config2 = createNeatConfig({ seed: 12345 });

  assertEquals(config1.sparseRatio, config2.sparseRatio);
  assertEquals(config1.globalBreedingRate, config2.globalBreedingRate);
  assertEquals(config1.selection, config2.selection);
});

Deno.test("NeatConfig: different seeds produce different config defaults", () => {
  // Run multiple pairs to increase confidence (randomised defaults differ)
  let sparseRatioDiffers = false;
  let breedingRateDiffers = false;

  for (let seedA = 1; seedA <= 20; seedA++) {
    const configA = createNeatConfig({ seed: seedA });
    const configB = createNeatConfig({ seed: seedA + 1000 });

    if (configA.sparseRatio !== configB.sparseRatio) sparseRatioDiffers = true;
    if (configA.globalBreedingRate !== configB.globalBreedingRate) {
      breedingRateDiffers = true;
    }
    if (sparseRatioDiffers && breedingRateDiffers) break;
  }

  assert(sparseRatioDiffers, "Expected sparseRatio to differ for some seeds");
  assert(
    breedingRateDiffers,
    "Expected globalBreedingRate to differ for some seeds",
  );
});

Deno.test("Mutation: same seed produces identical mutation results", () => {
  const creatureJson = new Creature(3, 1, { layers: [{ count: 4 }] })
    .exportJSON();

  function mutateWithSeed(seed: number): string {
    const config = createNeatConfig({
      seed,
      mutation: [Mutation.MOD_WEIGHT],
      mutationRate: 1,
      mutationAmount: 5,
    });
    const mutator = new Mutator(config);
    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    for (let i = 0; i < 10; i++) {
      mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
    }

    return JSON.stringify(creature.exportJSON());
  }

  const result1 = mutateWithSeed(42);
  const result2 = mutateWithSeed(42);
  assertEquals(
    result1,
    result2,
    "Same seed should produce identical mutations",
  );
});

Deno.test("Mutation: different seeds produce different results", () => {
  const creatureJson = new Creature(3, 1, { layers: [{ count: 4 }] })
    .exportJSON();

  function mutateWithSeed(seed: number): string {
    const config = createNeatConfig({
      seed,
      mutation: [Mutation.MOD_WEIGHT],
      mutationRate: 1,
      mutationAmount: 5,
    });
    const mutator = new Mutator(config);
    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    for (let i = 0; i < 10; i++) {
      mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
    }

    return JSON.stringify(creature.exportJSON());
  }

  const result1 = mutateWithSeed(42);
  const result2 = mutateWithSeed(999);
  assertNotEquals(
    result1,
    result2,
    "Different seeds should produce different mutations",
  );
});

Deno.test("Mutation: MOD_BIAS reproducible with seed", () => {
  const creatureJson = new Creature(2, 1, { layers: [{ count: 3 }] })
    .exportJSON();

  function mutateWithSeed(seed: number): string {
    const config = createNeatConfig({
      seed,
      mutation: [Mutation.MOD_BIAS],
      mutationRate: 1,
      mutationAmount: 5,
    });
    const mutator = new Mutator(config);
    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    for (let i = 0; i < 10; i++) {
      mutator.mutateCreature(creature, Mutation.MOD_BIAS);
    }

    return JSON.stringify(creature.exportJSON());
  }

  assertEquals(
    mutateWithSeed(77),
    mutateWithSeed(77),
    "Same seed should produce identical bias mutations",
  );
});
