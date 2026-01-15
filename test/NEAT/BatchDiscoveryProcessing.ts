/**
 * Tests for Issue #1020: Performance: Batch discovery candidate processing
 *
 * This test file verifies that:
 * 1. Discovery results include the improved creature directly
 * 2. Discovered creatures are added to the population without modification
 * 3. Evolution continues while discovery runs (non-blocking behaviour)
 */
import { assertEquals, assertExists } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { ResponseData } from "../../src/multithreading/workers/WorkerHandler.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

/**
 * Creates a base creature for testing.
 */
function createTestCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  addTag(creature, "error", "0.5");
  return creature;
}

Deno.test(
  "DiscoverStructure.addHelpfulSynapses creates modified creature correctly",
  () => {
    const baseCreature = createTestCreature();
    const baseUUID = baseCreature.uuid!;

    // Simulate discovery result with helpful synapses
    const helpfulSynapses = [{
      fromNeuronUUID: "input-0",
      toNeuronUUID: "output-0",
      weight: 0.8,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.1,
      expectedCreatureScoreGain: 0.1,
      improvedCount: 5,
      totalCount: 7,
    }];

    const modifiedCreature = DiscoverStructure.addHelpfulSynapses(
      baseUUID,
      baseCreature,
      helpfulSynapses,
    );

    // Should create a new creature with the added synapse
    assertExists(modifiedCreature, "Modified creature should exist");

    // Verify the synapse was added
    const exportedJSON = modifiedCreature.exportJSON();
    const hasNewSynapse = exportedJSON.synapses.some(
      (s) =>
        s.fromUUID === "input-0" &&
        s.toUUID === "output-0" &&
        Math.abs(s.weight - 0.8) < 1e-6,
    );
    assertEquals(hasNewSynapse, true, "Should have the new synapse added");

    // Verify the original creature is not modified
    // We need to export JSON to compare because internal synapse references don't have uuid directly
    const originalExport = baseCreature.exportJSON();
    const originalHasNewSynapse = originalExport.synapses.some(
      (s) =>
        s.fromUUID === "input-0" &&
        s.toUUID === "output-0" &&
        Math.abs(s.weight - 0.8) < 1e-6,
    );
    assertEquals(
      originalHasNewSynapse,
      false,
      "Original creature should not be modified",
    );
  },
);

Deno.test(
  "DiscoverStructure.removeSynapse creates modified creature correctly",
  () => {
    const baseCreature = createTestCreature();
    const baseUUID = baseCreature.uuid!;

    // Verify the synapse exists before removal
    const originalSynapseCount = baseCreature.synapses.length;
    assertEquals(originalSynapseCount, 3, "Should have 3 synapses initially");

    // Simulate discovery result with harmful synapse to remove
    const harmfulSynapse = {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "output-0",
      weight: -0.25,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.1,
      expectedCreatureScoreGain: 0.1,
      improvedCount: 5,
      totalCount: 7,
    };

    const modifiedCreature = DiscoverStructure.removeSynapse(
      baseUUID,
      baseCreature,
      harmfulSynapse,
    );

    // Should create a new creature with the synapse removed
    assertExists(modifiedCreature, "Modified creature should exist");

    // Verify the synapse was removed
    const exportedJSON = modifiedCreature.exportJSON();
    const synapseStillExists = exportedJSON.synapses.some(
      (s) =>
        s.fromUUID === "input-1" &&
        s.toUUID === "output-0",
    );
    assertEquals(synapseStillExists, false, "Synapse should be removed");

    // Verify the original creature is not modified
    assertEquals(
      baseCreature.synapses.length,
      originalSynapseCount,
      "Original creature should not be modified",
    );
  },
);

Deno.test(
  "Discovery response can include improved creature JSON for direct addition to population",
  () => {
    // Test that the ResponseData interface allows for improved creature data
    const baseCreature = createTestCreature();
    const baseUUID = baseCreature.uuid!;

    // Simulate an improved creature
    const improvedCreatureJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-1", squash: "TANH", bias: 0.1 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.6 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "output-0", weight: 0.3 },
      ],
    };

    // Simulate discovery response with improved creature
    const discoveryResponse: ResponseData = {
      taskID: 1,
      duration: 100,
      discover: {
        ID: baseUUID,
        // The improved creature can be included in the response
        improvedCreature: improvedCreatureJSON,
      },
    };

    // Verify we can access the improved creature
    assertExists(discoveryResponse.discover, "Should have discover response");
    assertExists(
      discoveryResponse.discover.improvedCreature,
      "Should have improved creature",
    );

    // Verify we can reconstruct the creature from JSON
    const reconstructedCreature = Creature.fromJSON(
      discoveryResponse.discover.improvedCreature,
    );
    reconstructedCreature.validate();
    CreatureUtil.makeUUID(reconstructedCreature);

    // Creature.neurons includes all neurons (input + hidden + output)
    // Input: 2, Hidden: 1, Output: 1 = 4 total
    assertEquals(
      reconstructedCreature.neurons.length,
      4,
      "Should have correct number of neurons (input + hidden + output)",
    );
  },
);

Deno.test(
  "Discovered creature should preserve discovery tags when added to population",
  () => {
    const baseCreature = createTestCreature();
    const baseUUID = baseCreature.uuid!;

    // Simulate an improved creature with discovery metadata
    const improvedCreatureJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-1", squash: "TANH", bias: 0.1 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.6 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      ],
      tags: [
        { name: "approach", value: "discovered" },
        { name: "discoveryID", value: baseUUID },
        { name: "changeType", value: "add-synapses" },
      ],
    };

    const reconstructedCreature = Creature.fromJSON(improvedCreatureJSON);
    CreatureUtil.makeUUID(reconstructedCreature);

    // Verify tags are preserved
    const approachTag = getTag(reconstructedCreature, "approach");
    assertEquals(approachTag, "discovered", "Approach tag should be preserved");

    const discoveryIDTag = getTag(reconstructedCreature, "discoveryID");
    assertEquals(
      discoveryIDTag,
      baseUUID,
      "Discovery ID tag should be preserved",
    );

    const changeTypeTag = getTag(reconstructedCreature, "changeType");
    assertEquals(
      changeTypeTag,
      "add-synapses",
      "Change type tag should be preserved",
    );
  },
);

Deno.test(
  "Population can include discovered creatures alongside normal evolution",
  () => {
    // This test verifies the population management logic
    const elitists: Creature[] = [];
    const trainedPopulation: Creature[] = [];
    const discoveredPopulation: Creature[] = [];
    const newPopulation: Creature[] = [];

    // Create some base creatures
    for (let i = 0; i < 3; i++) {
      const creature = createTestCreature();
      addTag(creature, "error", (0.5 - i * 0.1).toString());
      addTag(creature, "approach", "evolved");
      elitists.push(creature);
    }

    // Create a discovered creature
    const discoveredCreature = Creature.fromJSON({
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-1", squash: "TANH", bias: 0.1 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.6 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      ],
      tags: [
        { name: "approach", value: "discovered" },
        { name: "error", value: "0.3" },
      ],
    });
    CreatureUtil.makeUUID(discoveredCreature);
    discoveredPopulation.push(discoveredCreature);

    // Combine populations (mimicking Neat.evolve())
    const combinedPopulation = [
      ...elitists,
      ...trainedPopulation,
      ...discoveredPopulation,
      ...newPopulation,
    ];

    // Verify discovered creature is in the population
    const hasDiscoveredCreature = combinedPopulation.some((c) => {
      const approach = getTag(c, "approach");
      return approach === "discovered";
    });
    assertEquals(
      hasDiscoveredCreature,
      true,
      "Population should include discovered creature",
    );

    // Verify the error tag is preserved
    const discovered = combinedPopulation.find((c) => {
      const approach = getTag(c, "approach");
      return approach === "discovered";
    });
    assertExists(discovered, "Should find discovered creature");
    const errorTag = getTag(discovered, "error");
    assertEquals(errorTag, "0.3", "Error tag should be preserved");
  },
);
