/**
 * Tests for synapse candidate application without fix() corruption.
 *
 * Bug: Synapse Discovery Candidates Found But Not Applied
 *
 * The discovery process must not make valid creatures invalid then rely on
 * "fix()" to correct the problem. This leads to random connections being made
 * to "fix" the creature, but then the score of the creature will be worse
 * after applying the candidate.
 *
 * @see https://github.com/stSoftwareAU/NEAT-AI/issues/XXX
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { CandidateSynapse } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { buildDiscoveryCandidates } from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";

/**
 * Creates a valid creature with a specific structure where we can test
 * synapse addition without triggering fix() random connection behaviour.
 */
function makeValidCreatureWithGap(): {
  creature: Creature;
  missingSynapse: CandidateSynapse;
} {
  // Create a creature with a deliberate "gap" - a valid synapse that could be added
  // The creature is fully connected and valid, so fix() should NOT add any random connections.
  const exportJSON: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-A",
        squash: IDENTITY.NAME,
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "hidden-B",
        squash: IDENTITY.NAME,
        bias: 0.2,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      // Input layer fully connected to hidden-A
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-A", weight: -0.3 },
      // Hidden-A connects to output
      { fromUUID: "hidden-A", toUUID: "output-0", weight: 0.8 },
      // Input-2 connects to hidden-B (hidden-B has inward connection)
      { fromUUID: "input-2", toUUID: "hidden-B", weight: 0.4 },
      // Hidden-B connects to output (hidden-B has outward connection)
      { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.6 },
    ],
  };

  const creature = Creature.fromJSON(exportJSON);
  creature.validate();
  CreatureUtil.makeUUID(creature);

  // The "missing" synapse we want to add: input-0 -> hidden-B
  // This is a valid connection that doesn't exist yet.
  const missingSynapse: CandidateSynapse = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "hidden-B",
    weight: 0.75,
    expectedImprovementPercentage: 0.15,
    improvedCount: 10,
    totalCount: 12,
  };

  return { creature, missingSynapse };
}

Deno.test({
  name:
    "addHelpfulSynapses applies synapse when source and target exist - no fix() corruption",
  permissions: {
    read: true,
    write: true,
  },
  fn() {
    const { creature, missingSynapse } = makeValidCreatureWithGap();
    const originalUUID = CreatureUtil.makeUUID(creature);
    const originalSynapseCount = creature.exportJSON().synapses.length;

    // Apply the synapse candidate
    const result = DiscoverStructure.addHelpfulSynapses(
      "TEST-SYNAPSE-001",
      creature,
      [missingSynapse],
    );

    // CRITICAL: The result should NOT be undefined
    assertExists(
      result,
      "addHelpfulSynapses should return a creature when adding a valid synapse",
    );

    // Verify the synapse was added
    const exported = result.exportJSON();
    const addedSynapse = exported.synapses.find((s) =>
      s.fromUUID === missingSynapse.fromNeuronUUID &&
      s.toUUID === missingSynapse.toNeuronUUID
    );
    assertExists(
      addedSynapse,
      "The new synapse should exist in the result creature",
    );
    assertEquals(
      addedSynapse.weight,
      missingSynapse.weight,
      "The synapse weight should match",
    );

    // Verify synapse count increased by exactly 1 (fix() didn't add random synapses)
    assertEquals(
      exported.synapses.length,
      originalSynapseCount + 1,
      "Only the requested synapse should be added, fix() should not add random connections",
    );

    // Verify the UUID changed (because we added a synapse)
    const newUUID = CreatureUtil.makeUUID(result);
    assert(newUUID !== originalUUID, "UUID should change after adding synapse");

    // Verify the result is valid
    result.validate();
  },
});

Deno.test({
  name:
    "addHelpfulSynapses does not call fix() which could add random connections",
  permissions: {
    read: true,
    write: true,
  },
  fn() {
    // This test creates a creature and adds a synapse multiple times
    // to verify that the synapse count is deterministic (no random fix() behaviour)
    const results: number[] = [];

    for (let i = 0; i < 10; i++) {
      const { creature, missingSynapse } = makeValidCreatureWithGap();
      const result = DiscoverStructure.addHelpfulSynapses(
        `TEST-DETERMINISM-${i}`,
        creature,
        [missingSynapse],
      );

      if (result) {
        results.push(result.exportJSON().synapses.length);
      } else {
        results.push(-1); // Mark as failure
      }
    }

    // All results should be the same (deterministic)
    const firstResult = results[0];
    assert(firstResult > 0, "First result should not be a failure");

    for (let i = 1; i < results.length; i++) {
      assertEquals(
        results[i],
        firstResult,
        `Run ${i} should have same synapse count as run 0. If this fails, fix() is adding random connections.`,
      );
    }
  },
});

Deno.test({
  name:
    "synapse candidates appear in evaluation output via buildDiscoveryCandidates",
  permissions: {
    read: true,
    write: true,
  },
  fn() {
    const { creature, missingSynapse } = makeValidCreatureWithGap();

    const discovery: DiscoverResult = {
      ID: "END-TO-END-SYNAPSE",
      addHelpfulSynapses: [missingSynapse],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(creature, discovery);

    // There should be at least one "add-synapses" candidate
    const synapseCandidates = candidates.filter((c) =>
      c.change.type === "add-synapses"
    );
    assert(
      synapseCandidates.length > 0,
      "Should have at least one add-synapses candidate in evaluation output",
    );

    // Verify the synapse was actually added to the candidate creature
    const singleSynapseCandidate = synapseCandidates.find((c) => {
      const exported = c.creature.exportJSON();
      return exported.synapses.some((s) =>
        s.fromUUID === missingSynapse.fromNeuronUUID &&
        s.toUUID === missingSynapse.toNeuronUUID
      );
    });
    assertExists(
      singleSynapseCandidate,
      "Should have a candidate containing the added synapse",
    );
  },
});

Deno.test({
  name: "addHelpfulSynapses skips synapse that already exists (with warning)",
  permissions: {
    read: true,
    write: true,
  },
  fn() {
    const { creature } = makeValidCreatureWithGap();
    const originalSynapseCount = creature.exportJSON().synapses.length;

    // Try to add a synapse that already exists
    const duplicateSynapse: CandidateSynapse = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-A", // This connection already exists
      weight: 0.99,
      expectedImprovementPercentage: 0.1,
      improvedCount: 5,
      totalCount: 6,
    };

    const result = DiscoverStructure.addHelpfulSynapses(
      "TEST-DUPLICATE",
      creature,
      [duplicateSynapse],
    );

    // When the synapse already exists, the function should return undefined
    // (no changes were made)
    assertEquals(
      result,
      undefined,
      "Should return undefined when synapse already exists",
    );

    // Verify original creature unchanged
    assertEquals(
      creature.exportJSON().synapses.length,
      originalSynapseCount,
      "Original creature should not be modified",
    );
  },
});

Deno.test({
  name: "addHelpfulSynapses handles mix of valid and invalid synapses",
  permissions: {
    read: true,
    write: true,
  },
  fn() {
    const { creature, missingSynapse } = makeValidCreatureWithGap();
    const originalSynapseCount = creature.exportJSON().synapses.length;

    // Mix of valid new synapse, duplicate synapse, and synapse with non-existent target
    const mixedSynapses: CandidateSynapse[] = [
      missingSynapse, // Valid - should be added
      {
        fromNeuronUUID: "input-0",
        toNeuronUUID: "hidden-A", // Duplicate - should be skipped
        weight: 0.99,
        expectedImprovementPercentage: 0.1,
        improvedCount: 5,
        totalCount: 6,
      },
      {
        fromNeuronUUID: "input-1",
        toNeuronUUID: "non-existent-neuron", // Invalid target - should be skipped
        weight: 0.5,
        expectedImprovementPercentage: 0.2,
        improvedCount: 3,
        totalCount: 4,
      },
    ];

    const result = DiscoverStructure.addHelpfulSynapses(
      "TEST-MIXED",
      creature,
      mixedSynapses,
    );

    // Result should exist because at least one valid synapse was added
    assertExists(
      result,
      "Should return creature when at least one valid synapse is added",
    );

    const exported = result.exportJSON();

    // Only 1 synapse should be added (the valid one)
    assertEquals(
      exported.synapses.length,
      originalSynapseCount + 1,
      "Only the valid synapse should be added",
    );

    // Verify the correct synapse was added
    const addedSynapse = exported.synapses.find((s) =>
      s.fromUUID === missingSynapse.fromNeuronUUID &&
      s.toUUID === missingSynapse.toNeuronUUID
    );
    assertExists(addedSynapse, "The valid synapse should be added");
  },
});

Deno.test({
  name:
    "fix() does not revert valid synapse additions - creature structure preserved",
  permissions: {
    read: true,
    write: true,
  },
  fn() {
    const { creature, missingSynapse } = makeValidCreatureWithGap();

    // Add synapse using the fixed method
    const result = DiscoverStructure.addHelpfulSynapses(
      "TEST-FIX-PRESERVES",
      creature,
      [missingSynapse],
    );
    assertExists(result, "Should return creature with synapse");

    // Manually call fix() on the result to verify it doesn't break anything
    const beforeFix = result.exportJSON();
    result.fix();
    const afterFix = result.exportJSON();

    // Synapse should still exist after fix()
    const synapseAfterFix = afterFix.synapses.find((s) =>
      s.fromUUID === missingSynapse.fromNeuronUUID &&
      s.toUUID === missingSynapse.toNeuronUUID
    );
    assertExists(synapseAfterFix, "Synapse should still exist after fix()");

    // Synapse count should be the same (fix() shouldn't add or remove anything)
    assertEquals(
      beforeFix.synapses.length,
      afterFix.synapses.length,
      "fix() should not change synapse count on a valid creature",
    );
  },
});

Deno.test({
  name:
    "validate-first approach: fix() not called when creature remains valid after synapse addition",
  permissions: {
    read: true,
    write: true,
  },
  fn() {
    const { creature, missingSynapse } = makeValidCreatureWithGap();

    // Apply the synapse candidate
    const result = DiscoverStructure.addHelpfulSynapses(
      "TEST-VALIDATE-FIRST",
      creature,
      [missingSynapse],
    );

    assertExists(result, "Should return creature with synapse");

    // If fix() was not called (because validation passed), there should be no
    // "discovery-fix-required" tag on the creature
    const exported = result.exportJSON();
    const hasFixRequiredTag = exported.tags?.some((t) =>
      typeof t === "object" && "discovery-fix-required" in t
    );

    assertEquals(
      hasFixRequiredTag,
      false,
      "discovery-fix-required tag should NOT be present when fix() was not needed",
    );

    // Verify the synapse was added correctly
    const addedSynapse = exported.synapses.find((s) =>
      s.fromUUID === missingSynapse.fromNeuronUUID &&
      s.toUUID === missingSynapse.toNeuronUUID
    );
    assertExists(addedSynapse, "The new synapse should exist");
    assertEquals(addedSynapse.weight, missingSynapse.weight);
  },
});
