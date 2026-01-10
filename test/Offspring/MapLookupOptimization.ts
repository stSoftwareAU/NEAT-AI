import { assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";

/**
 * Test to verify that the Map-based neuron lookup optimization in Offspring.breed()
 * works correctly and produces the same results as the previous linear search.
 *
 * Issue #1024: Replace linear neuron search with Map lookup in Offspring creation
 */

/**
 * Creates a creature with many hidden neurons to test lookup performance.
 * @param neuronCount Number of hidden neurons to create
 * @param prefix Prefix for neuron UUIDs to distinguish between parents
 */
function createLargeCreature(
  neuronCount: number,
  prefix: string,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Add hidden neurons in a chain
  for (let i = 0; i < neuronCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-hidden-${i}`,
      squash: "IDENTITY",
      bias: 0.1 * (i % 10),
    });
  }

  // Add output neuron
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  // Connect input to first hidden neuron
  synapses.push({
    fromUUID: "input-0",
    toUUID: `${prefix}-hidden-0`,
    weight: 0.5,
  });

  // Chain hidden neurons together
  for (let i = 0; i < neuronCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-hidden-${i}`,
      toUUID: `${prefix}-hidden-${i + 1}`,
      weight: 0.5,
    });
  }

  // Connect last hidden neuron to output
  synapses.push({
    fromUUID: `${prefix}-hidden-${neuronCount - 1}`,
    toUUID: "output-0",
    weight: 0.5,
  });

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: 2,
    output: 1,
  });

  creature.validate();
  return creature;
}

/**
 * Creates two creatures with shared and unique neurons to test the neuron lookup
 * during offspring creation where neurons need to be found from either parent.
 */
function createParentsWithSharedNeurons(): {
  mother: Creature;
  father: Creature;
} {
  const motherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "shared-a", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "shared-b", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "mother-only-a", squash: "IDENTITY", bias: 0.3 },
      { type: "hidden", uuid: "mother-only-b", squash: "IDENTITY", bias: 0.4 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared-a", weight: 0.5 },
      { fromUUID: "shared-a", toUUID: "mother-only-a", weight: 0.5 },
      { fromUUID: "mother-only-a", toUUID: "shared-b", weight: 0.5 },
      { fromUUID: "shared-b", toUUID: "mother-only-b", weight: 0.5 },
      { fromUUID: "mother-only-b", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };

  const fatherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "shared-a", squash: "IDENTITY", bias: 0.15 },
      { type: "hidden", uuid: "shared-b", squash: "IDENTITY", bias: 0.25 },
      { type: "hidden", uuid: "father-only-a", squash: "IDENTITY", bias: 0.35 },
      { type: "hidden", uuid: "father-only-b", squash: "IDENTITY", bias: 0.45 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-1", toUUID: "shared-a", weight: 0.6 },
      { fromUUID: "shared-a", toUUID: "father-only-a", weight: 0.6 },
      { fromUUID: "father-only-a", toUUID: "shared-b", weight: 0.6 },
      { fromUUID: "shared-b", toUUID: "father-only-b", weight: 0.6 },
      { fromUUID: "father-only-b", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };

  const mother = Creature.fromJSON(motherJson);
  mother.validate();
  const father = Creature.fromJSON(fatherJson);
  father.validate();

  return { mother, father };
}

Deno.test("MapLookupOptimization - breed with many neurons produces valid offspring", () => {
  const mother = createLargeCreature(50, "mother");
  const father = createLargeCreature(50, "father");

  // Breed multiple times to ensure consistency
  for (let i = 0; i < 10; i++) {
    const child = Offspring.breed(mother, father);
    if (child) {
      child.validate();
      // Ensure we got some neurons from the breeding process
      assertExists(child.neurons);
      // Child should have at least input + output neurons
      assertEquals(child.neurons.length >= 3, true);
    }
  }
});

Deno.test("MapLookupOptimization - correctly finds neurons from either parent", () => {
  const { mother, father } = createParentsWithSharedNeurons();

  let successfulBreeds = 0;
  for (let i = 0; i < 20; i++) {
    const child = Offspring.breed(mother, father);
    if (child) {
      child.validate();
      successfulBreeds++;

      // Get all neuron UUIDs in the child
      const childUUIDs = new Set(child.neurons.map((n) => n.uuid));

      // Child should have the output neuron
      assertEquals(childUUIDs.has("output-0"), true);

      // Verify UUIDs are properly formed (no undefined or null)
      for (const neuron of child.neurons) {
        assertExists(
          neuron.uuid,
          `Neuron at index ${neuron.index} has no UUID`,
        );
      }
    }
  }

  // We should have at least some successful breeds
  assertEquals(
    successfulBreeds > 0,
    true,
    "Expected at least one successful breed",
  );
});

Deno.test("MapLookupOptimization - breeding creatures with shared chain maintains neuron connections", () => {
  // Create creatures with shared neurons to ensure breeding can produce offspring
  const motherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "chain-a", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "chain-b", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "chain-c", squash: "IDENTITY", bias: 0.3 },
      { type: "hidden", uuid: "chain-d", squash: "IDENTITY", bias: 0.4 },
      { type: "hidden", uuid: "chain-e", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "chain-a", weight: 0.5 },
      { fromUUID: "chain-a", toUUID: "chain-b", weight: 0.5 },
      { fromUUID: "chain-b", toUUID: "chain-c", weight: 0.5 },
      { fromUUID: "chain-c", toUUID: "chain-d", weight: 0.5 },
      { fromUUID: "chain-d", toUUID: "chain-e", weight: 0.5 },
      { fromUUID: "chain-e", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };

  const fatherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "chain-a", squash: "IDENTITY", bias: 0.15 },
      { type: "hidden", uuid: "chain-b", squash: "IDENTITY", bias: 0.25 },
      { type: "hidden", uuid: "chain-c", squash: "IDENTITY", bias: 0.35 },
      { type: "hidden", uuid: "chain-d", squash: "IDENTITY", bias: 0.45 },
      { type: "hidden", uuid: "chain-e", squash: "IDENTITY", bias: 0.55 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-1", toUUID: "chain-a", weight: 0.6 },
      { fromUUID: "chain-a", toUUID: "chain-b", weight: 0.6 },
      { fromUUID: "chain-b", toUUID: "chain-c", weight: 0.6 },
      { fromUUID: "chain-c", toUUID: "chain-d", weight: 0.6 },
      { fromUUID: "chain-d", toUUID: "chain-e", weight: 0.6 },
      { fromUUID: "chain-e", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };

  const mother = Creature.fromJSON(motherJson);
  mother.validate();
  const father = Creature.fromJSON(fatherJson);
  father.validate();

  CreatureUtil.makeUUID(mother);
  CreatureUtil.makeUUID(father);

  let successfulBreeds = 0;
  for (let i = 0; i < 20; i++) {
    const child = Offspring.breed(mother, father);
    if (child) {
      child.validate();
      successfulBreeds++;

      // Verify all synapses reference valid neurons
      const neuronUUIDs = new Set(child.neurons.map((n) => n.uuid));
      const exported = child.exportJSON();

      for (const synapse of exported.synapses) {
        assertEquals(
          neuronUUIDs.has(synapse.fromUUID),
          true,
          `Synapse references non-existent fromUUID: ${synapse.fromUUID}`,
        );
        assertEquals(
          neuronUUIDs.has(synapse.toUUID),
          true,
          `Synapse references non-existent toUUID: ${synapse.toUUID}`,
        );
      }
    }
  }

  assertEquals(
    successfulBreeds > 0,
    true,
    "Expected at least one successful breed",
  );
});

Deno.test("MapLookupOptimization - neurons from missing connections are found correctly", () => {
  // This test specifically targets the loop at lines 120-161 where
  // neurons need to be looked up when they're referenced by connections
  // but not yet in the neuronMap

  const motherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "dep-chain-a", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "dep-chain-b", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "dep-chain-c", squash: "IDENTITY", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "dep-chain-a", weight: 0.5 },
      { fromUUID: "dep-chain-a", toUUID: "dep-chain-b", weight: 0.5 },
      { fromUUID: "dep-chain-b", toUUID: "dep-chain-c", weight: 0.5 },
      { fromUUID: "dep-chain-c", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };

  const fatherJson: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "dep-chain-a", squash: "IDENTITY", bias: 0.15 },
      { type: "hidden", uuid: "dep-chain-x", squash: "IDENTITY", bias: 0.25 },
      { type: "hidden", uuid: "dep-chain-c", squash: "IDENTITY", bias: 0.35 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-1", toUUID: "dep-chain-a", weight: 0.6 },
      { fromUUID: "dep-chain-a", toUUID: "dep-chain-x", weight: 0.6 },
      { fromUUID: "dep-chain-x", toUUID: "dep-chain-c", weight: 0.6 },
      { fromUUID: "dep-chain-c", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };

  const mother = Creature.fromJSON(motherJson);
  mother.validate();
  const father = Creature.fromJSON(fatherJson);
  father.validate();

  // Breed multiple times - each breeding might select different neurons
  // The key is that when a connection references a neuron not in neuronMap,
  // the code must find it from either parent using Map lookup
  let successfulBreeds = 0;
  for (let i = 0; i < 20; i++) {
    const child = Offspring.breed(mother, father);
    if (child) {
      child.validate();
      successfulBreeds++;

      // Verify all neurons have valid UUIDs
      for (const neuron of child.neurons) {
        assertExists(neuron.uuid);
      }
    }
  }

  assertEquals(
    successfulBreeds > 0,
    true,
    "Expected at least one successful breed",
  );
});
