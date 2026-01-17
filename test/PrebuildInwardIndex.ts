/**
 * Test: Prebuild inward synapse index after breed/mutation batch (Issue #1097)
 *
 * This test verifies that prebuildInwardIndex() is called proactively in key locations:
 * 1. After breeding a new creature (Offspring.breed())
 * 2. After mutation batch completes (Mutator.mutate())
 * 3. After loading from JSON (Creature.fromJSON() / loadFrom())
 *
 * The optimisation only applies to creatures with many synapses (>= 1000 by default)
 * to balance upfront cost vs amortised benefit.
 */
import { assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { Offspring } from "../src/architecture/Offspring.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Creates a large creature with the specified number of neurons and approximately
 * the given number of synapses for testing the prebuild optimisation.
 */
function createLargeCreature(
  inputCount: number,
  outputCount: number,
  hiddenLayers: number[],
): Creature {
  const layers = hiddenLayers.map((count) => ({ count }));
  const creature = new Creature(inputCount, outputCount, { layers });
  creature.validate();
  return creature;
}

/**
 * Creates a simple small creature for testing cases where prebuilding
 * should NOT occur (under the synapse threshold).
 */
function createSmallCreature(): Creature {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "hidden", squash: "LOGISTIC", index: 2, bias: 0 },
      { type: "output", squash: "LOGISTIC", index: 3, bias: 0 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 2 },
      { from: 2, to: 3, weight: 3 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

// ============================================================================
// Tests for Offspring.breed()
// ============================================================================

Deno.test("Offspring.breed() prebuilds inward index for large creatures", () => {
  // Create two large parent creatures with many synapses
  const mum = createLargeCreature(30, 10, [100, 80, 50]);
  const dad = createLargeCreature(30, 10, [90, 70, 60]);

  // Verify the parents have enough synapses to trigger prebuilding
  assertEquals(
    mum.synapses.length >= 1000,
    true,
    `Mother should have >= 1000 synapses, has ${mum.synapses.length}`,
  );
  assertEquals(
    dad.synapses.length >= 1000,
    true,
    `Father should have >= 1000 synapses, has ${dad.synapses.length}`,
  );

  // Breed offspring
  const offspring = Offspring.breed(mum, dad);
  if (offspring === undefined) {
    // Breeding can sometimes return undefined (e.g., if child equals parent)
    // Skip this test run
    return;
  }

  // Verify the offspring has many synapses
  assertEquals(
    offspring.synapses.length >= 1000,
    true,
    `Offspring should have >= 1000 synapses, has ${offspring.synapses.length}`,
  );

  // Verify the inward index is prebuilt
  assertEquals(
    offspring.isInwardIndexBuilt(),
    true,
    "Offspring should have prebuilt inward index after breed()",
  );
});

Deno.test("Offspring.breed() does not prebuild inward index for small creatures", () => {
  // Create small parent creatures
  const mum = createSmallCreature();
  const dad = createSmallCreature();

  // Verify the parents have few synapses
  assertEquals(
    mum.synapses.length < 1000,
    true,
    `Mother should have < 1000 synapses, has ${mum.synapses.length}`,
  );

  // Breed offspring
  const offspring = Offspring.breed(mum, dad);
  if (offspring === undefined) {
    return;
  }

  // Small creatures should not have prebuilt index (not worth the upfront cost)
  assertEquals(
    offspring.isInwardIndexBuilt(),
    false,
    "Small offspring should not have prebuilt inward index",
  );
});

// ============================================================================
// Tests for Mutator.mutate()
// ============================================================================

Deno.test("Mutator.mutate() prebuilds inward index for large creatures", () => {
  // Create a large creature
  const creature = createLargeCreature(30, 10, [100, 80, 50]);

  assertEquals(
    creature.synapses.length >= 1000,
    true,
    `Creature should have >= 1000 synapses, has ${creature.synapses.length}`,
  );

  // Clear the inward index to start fresh
  creature.clearCache();
  assertEquals(
    creature.isInwardIndexBuilt(),
    false,
    "Index should be cleared before mutation",
  );

  // Create a mutator and mutate the creature
  const config = createNeatConfig({
    mutationRate: 1.0, // Always mutate
    mutationAmount: 3, // Multiple mutations per batch
  });
  const mutator = new Mutator(config);
  mutator.mutate([creature]);

  // After mutation batch, the index should be prebuilt
  assertEquals(
    creature.isInwardIndexBuilt(),
    true,
    "Large creature should have prebuilt inward index after mutation batch",
  );
});

Deno.test("prebuildInwardIndexIfLarge() does not build index for small creatures", () => {
  // Create a small creature
  const creature = createSmallCreature();

  assertEquals(
    creature.synapses.length < 1000,
    true,
    `Creature should have < 1000 synapses, has ${creature.synapses.length}`,
  );

  // Clear the index
  creature.clearCache();
  assertEquals(
    creature.isInwardIndexBuilt(),
    false,
    "Index should be cleared before test",
  );

  // Conditionally prebuild - should not build for small creatures
  creature.prebuildInwardIndexIfLarge();

  // Small creatures should not have prebuilt index via prebuildInwardIndexIfLarge()
  assertEquals(
    creature.isInwardIndexBuilt(),
    false,
    "Small creature should not have prebuilt inward index via prebuildInwardIndexIfLarge()",
  );
});

// ============================================================================
// Tests for Creature.fromJSON() / loadFrom()
// ============================================================================

Deno.test("Creature.fromJSON() prebuilds inward index for large creatures", () => {
  // Create a large creature and export it
  const original = createLargeCreature(30, 10, [100, 80, 50]);
  const json = original.exportJSON();

  assertEquals(
    json.synapses.length >= 1000,
    true,
    `JSON should have >= 1000 synapses, has ${json.synapses.length}`,
  );

  // Load from JSON
  const loaded = Creature.fromJSON(json);

  // Verify the inward index is prebuilt
  assertEquals(
    loaded.isInwardIndexBuilt(),
    true,
    "Large creature should have prebuilt inward index after fromJSON()",
  );
});

Deno.test("Creature.fromJSON() does not prebuild inward index for small creatures", () => {
  // Create a small creature and export it
  const original = createSmallCreature();
  const json = original.exportJSON();

  assertEquals(
    json.synapses.length < 1000,
    true,
    `JSON should have < 1000 synapses, has ${json.synapses.length}`,
  );

  // Load from JSON
  const loaded = Creature.fromJSON(json);

  // Small creatures should not have prebuilt index
  assertEquals(
    loaded.isInwardIndexBuilt(),
    false,
    "Small creature should not have prebuilt inward index after fromJSON()",
  );
});

Deno.test("loadFrom() prebuilds inward index for large creatures", () => {
  // Create a large creature and export it
  const original = createLargeCreature(30, 10, [100, 80, 50]);
  const json = original.exportJSON();

  assertEquals(
    json.synapses.length >= 1000,
    true,
    `JSON should have >= 1000 synapses, has ${json.synapses.length}`,
  );

  // Create a new creature and load from JSON
  const creature = new Creature(json.input, json.output, {
    lazyInitialization: true,
    semanticVersion: json.semanticVersion,
  });
  creature.loadFrom(json, true);

  // Verify the inward index is prebuilt
  assertEquals(
    creature.isInwardIndexBuilt(),
    true,
    "Large creature should have prebuilt inward index after loadFrom()",
  );
});

// ============================================================================
// Tests for explicit prebuildInwardIndex() calls
// ============================================================================

Deno.test("prebuildInwardIndex() builds the index", () => {
  const creature = createSmallCreature();

  // Ensure the index is not built
  creature.clearCache();
  assertEquals(
    creature.isInwardIndexBuilt(),
    false,
    "Index should be cleared",
  );

  // Explicitly prebuild
  creature.prebuildInwardIndex();

  // Now the index should be built
  assertEquals(
    creature.isInwardIndexBuilt(),
    true,
    "Index should be built after prebuildInwardIndex()",
  );
});

Deno.test("clearCache() clears the inward index", () => {
  const creature = createSmallCreature();

  // Build the index
  creature.prebuildInwardIndex();
  assertEquals(
    creature.isInwardIndexBuilt(),
    true,
    "Index should be built",
  );

  // Clear the cache
  creature.clearCache();

  // Index should be cleared
  assertEquals(
    creature.isInwardIndexBuilt(),
    false,
    "Index should be cleared after clearCache()",
  );
});
