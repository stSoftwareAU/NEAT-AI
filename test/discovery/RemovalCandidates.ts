/**
 * Tests for removal candidate functionality.
 *
 * Removal candidates are neurons with high error but very low impact (< 1%
 * contribution to outputs). These neurons consume compute but don't
 * meaningfully contribute to the creature's score.
 */

import { assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RemovalCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  buildCombinedFromSuccessful,
  buildDiscoveryCandidates,
} from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";

Deno.test("removeLowImpactNeuron applies bias compensation for outgoing synapses", () => {
  // X -> T removes average contribution of (w * meanActivation(X)) from T's pre-activation sum,
  // so compensate by adjusting T.bias += w * meanActivation(X).
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", squash: "IDENTITY", bias: 0.25, uuid: "neuron-X" },
      { type: "hidden", squash: "IDENTITY", bias: -0.1, uuid: "neuron-T" },
      { type: "output", squash: "IDENTITY", bias: 0.05, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "neuron-X", weight: 1.0 },
      { fromUUID: "neuron-X", toUUID: "neuron-T", weight: -1.2 },
      { fromUUID: "neuron-X", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "neuron-T", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });

  const candidate: RemovalCandidate = {
    neuronUUID: "neuron-X",
    totalError: 5.0,
    impact: 0.001,
    reason: "Test",
    meanActivation: 0.4,
  };

  const result = DiscoverStructure.removeLowImpactNeuron(
    "test-discovery",
    creature,
    candidate,
  );

  assertExists(result, "Should return a modified creature");

  // Verify the neuron was removed
  assertEquals(
    result.neurons.some((n) => n.uuid === "neuron-X"),
    false,
    "Removed neuron should not exist",
  );
  assertEquals(
    result.exportJSON().synapses.some((s) =>
      s.fromUUID === "neuron-X" || s.toUUID === "neuron-X"
    ),
    false,
    "All synapses to/from removed neuron should be removed",
  );

  // Bias compensation checks:
  // - neuron-T.bias += (-1.2 * 0.4) = -0.48
  // - output-0.bias += (0.5 * 0.4) = +0.2
  const neuronT = result.neurons.find((n) => n.uuid === "neuron-T");
  assertExists(neuronT, "Target neuron should remain");
  assertEquals(neuronT.bias, -0.1 + (-1.2 * 0.4));

  const output0 = result.neurons.find((n) => n.uuid === "output-0");
  assertExists(output0, "Output neuron should remain");
  assertEquals(output0.bias, 0.05 + (0.5 * 0.4));
});

Deno.test("removeLowImpactNeuron makes no bias changes when removed neuron has no outgoing synapses", () => {
  // Create a simple creature with a hidden neuron
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", squash: "RELU", bias: 0.5, uuid: "hidden-orphan" },
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-orphan", weight: 0.1 },
      // Note: hidden-orphan has no outgoing connection to output - it's a dead end
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const candidate: RemovalCandidate = {
    neuronUUID: "hidden-orphan",
    totalError: 5.0,
    impact: 0.001, // Very low impact (0.1%)
    reason: "High error but very low impact - far from outputs",
    meanActivation: 123.456, // Should be ignored because there are no outgoing synapses
  };

  const result = DiscoverStructure.removeLowImpactNeuron(
    "test-discovery",
    creature,
    candidate,
  );

  assertExists(result, "Should return a modified creature");

  // Verify the neuron was removed
  const hiddenNeurons = result.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length, 0, "Hidden neuron should be removed");

  // Verify remaining structure is intact
  const nonInputNeurons = result.neurons.filter((n) => n.type !== "input");
  assertEquals(
    nonInputNeurons.length,
    1,
    "Should have 1 non-input neuron remaining (the output)",
  );
  assertEquals(result.synapses.length, 1, "Should have 1 synapse remaining");

  const output0 = result.neurons.find((n) => n.uuid === "output-0");
  assertExists(output0, "Output neuron should remain");
  assertEquals(output0.bias, 0, "Output bias should be unchanged");
});

Deno.test("removeLowImpactNeuron returns undefined for non-existent neuron", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const candidate: RemovalCandidate = {
    neuronUUID: "non-existent",
    totalError: 5.0,
    impact: 0.001,
    reason: "Test",
  };

  const result = DiscoverStructure.removeLowImpactNeuron(
    "test-discovery",
    creature,
    candidate,
  );

  assertEquals(result, undefined, "Should return undefined for missing neuron");
});

Deno.test("removeLowImpactNeuron returns undefined for output neurons", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const candidate: RemovalCandidate = {
    neuronUUID: "output-0",
    totalError: 5.0,
    impact: 0.001,
    reason: "Test",
  };

  const result = DiscoverStructure.removeLowImpactNeuron(
    "test-discovery",
    creature,
    candidate,
  );

  assertEquals(
    result,
    undefined,
    "Should return undefined for output neurons",
  );
});

Deno.test("buildDiscoveryCandidates creates removal candidates for low-impact neurons", () => {
  const baseCreature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", squash: "RELU", bias: 0.5, uuid: "hidden-low-impact" },
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-low-impact", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const discovery: DiscoverResult = {
    ID: "test-discovery",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [
      {
        neuronUUID: "hidden-low-impact",
        totalError: 5.0,
        impact: 0.005, // 0.5% impact
        reason: "High error (5.0000) but very low impact (0.005000)",
      },
    ],
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery);

  // Should have at least one candidate for the low-impact removal
  const lowImpactCandidates = candidates.filter(
    (c) => c.change.type === "remove-low-impact",
  );

  assertEquals(
    lowImpactCandidates.length,
    1,
    "Should create one low-impact removal candidate",
  );

  const candidate = lowImpactCandidates[0];
  assertExists(candidate.creature, "Candidate should have a creature");
  assertEquals(
    candidate.change.type,
    "remove-low-impact",
    "Change type should be remove-low-impact",
  );

  // Verify the neuron was actually removed in the candidate creature
  const hiddenNeurons = candidate.creature.neurons.filter(
    (n) => n.type === "hidden",
  );
  assertEquals(
    hiddenNeurons.length,
    0,
    "Candidate creature should have no hidden neurons",
  );
});

Deno.test("buildDiscoveryCandidates creates removal candidate with undefined expectedErrorReduction", () => {
  const baseCreature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", squash: "RELU", bias: 0.5, uuid: "hidden-low-impact" },
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-low-impact", weight: 1e-12 },
      { fromUUID: "hidden-low-impact", toUUID: "output-0", weight: 1e-12 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const discovery: DiscoverResult = {
    ID: "test-removal-expected",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [
      {
        neuronUUID: "hidden-low-impact",
        totalError: 1.0,
        impact: 1e-10, // Impact below costOfGrowth
        reason: "Impact below costOfGrowth",
      },
    ],
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery);

  const lowImpactCandidates = candidates.filter(
    (c) => c.change.type === "remove-low-impact",
  );

  assertEquals(
    lowImpactCandidates.length,
    1,
    "Should create one low-impact removal candidate",
  );

  const candidate = lowImpactCandidates[0];

  // Verify expectedErrorReduction is undefined (not costOfGrowth)
  // Removal candidates improve score via complexity reduction, not error reduction
  // Setting it to costOfGrowth would cause them to be filtered out since
  // costOfGrowth < costOfGrowth * multiplier (default multiplier = 2.0)
  assertEquals(
    candidate.change.expectedErrorReduction,
    undefined,
    "Expected error reduction should be undefined for removal candidates",
  );
});

/**
 * This test verifies that removal candidates with expectedErrorReduction set to costOfGrowth
 * would be filtered out during evaluation. The fix is to leave expectedErrorReduction as undefined.
 *
 * The filter logic in DiscoveryRunner.#filterCandidatesForEvaluation uses:
 * - minExpectedImprovement = costOfGrowth * multiplier (default multiplier = 2.0)
 * - Candidates pass if: expected === undefined OR expected >= minExpectedImprovement
 *
 * So if expectedErrorReduction = costOfGrowth, the check becomes:
 * costOfGrowth >= costOfGrowth * 2.0 = FALSE (gets filtered out!)
 *
 * Removal candidates should have undefined expectedErrorReduction because:
 * 1. They don't reduce error - they may slightly increase it
 * 2. They improve SCORE (not error) by reducing complexity
 * 3. The filter explicitly allows undefined through for cases like this
 */
Deno.test("removal candidates should have undefined expectedErrorReduction to pass filter", () => {
  const baseCreature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", squash: "RELU", bias: 0.5, uuid: "hidden-low-impact" },
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-low-impact", weight: 1e-12 },
      { fromUUID: "hidden-low-impact", toUUID: "output-0", weight: 1e-12 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const discovery: DiscoverResult = {
    ID: "filter-test",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [
      {
        neuronUUID: "hidden-low-impact",
        totalError: 1.0,
        impact: 1e-10,
        reason: "Impact below costOfGrowth",
      },
    ],
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery);

  const lowImpactCandidate = candidates.find(
    (c) => c.change.type === "remove-low-impact",
  );

  assertExists(lowImpactCandidate, "Should create removal candidate");

  // CRITICAL: expectedErrorReduction should be undefined for removal candidates
  // If it were set to costOfGrowth, it would fail the filter check:
  // costOfGrowth >= costOfGrowth * 2.0 = false (filtered out!)
  assertEquals(
    lowImpactCandidate.change.expectedErrorReduction,
    undefined,
    "Removal candidates should have undefined expectedErrorReduction to pass through filter",
  );
});

Deno.test("buildDiscoveryCandidates uses crippled-removal.json for near-zero weight neuron removal", async () => {
  // Load the test creature with near-zero weight synapses
  const jsonPath = new URL("../data/crippled-removal.json", import.meta.url);
  const jsonText = await Deno.readTextFile(jsonPath);
  const creatureJSON = JSON.parse(jsonText);
  const baseCreature = Creature.fromJSON(creatureJSON);

  // Simulate what Rust would return - neuron with near-zero weight synapses
  // has impact below costOfGrowth
  const discovery: DiscoverResult = {
    ID: "crippled-removal-test",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [
      {
        neuronUUID: "candidate-for-removal",
        totalError: 0.001,
        impact: 1e-24, // Near-zero impact due to 1e-12 weight synapses
        reason: "Impact below costOfGrowth",
      },
    ],
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery);

  const removalCandidates = candidates.filter(
    (c) => c.change.type === "remove-low-impact",
  );

  assertEquals(
    removalCandidates.length,
    1,
    "Should identify the near-zero weight neuron for removal",
  );

  const candidate = removalCandidates[0];

  // Verify the neuron was removed
  const removedNeuronExists = candidate.creature.neurons.some(
    (n) => n.uuid === "candidate-for-removal",
  );
  assertEquals(
    removedNeuronExists,
    false,
    "candidate-for-removal neuron should be removed",
  );

  // Verify expectedErrorReduction is undefined (not costOfGrowth)
  // Removal improves score via complexity reduction, not error reduction
  assertEquals(
    candidate.change.expectedErrorReduction,
    undefined,
    "Removal candidates should have undefined expectedErrorReduction",
  );

  // Verify the description mentions impact, not error
  assertExists(
    candidate.change.description,
    "Should have a description",
  );
  assertEquals(
    candidate.change.description?.includes("impact:"),
    true,
    "Description should mention impact",
  );
});

/**
 * Test for issue #920: Combined removal candidate should be created even if
 * one removal fails during sequential application.
 *
 * When building a combined candidate (Phase 2), if one neuron is already removed
 * as part of orphan cleanup from a previous removal, the combination loop should
 * continue with remaining removals rather than aborting entirely.
 *
 * Expected: We still produce a combined candidate that removes the remaining
 * neurons (even if one step becomes a no-op because it was already removed).
 */
Deno.test("combined removal candidate should be created when some removals fail", () => {
  // Create a creature where neuron A connects only to neuron B.
  // The order in removalCandidates is [B, A, C]:
  // - When B is removed first in the combined loop, A becomes orphaned and is cleaned up
  // - When we try to remove A second, it fails (already removed by orphan cleanup)
  // - The bug causes the loop to break, missing C
  // - The fix should skip A and continue with C
  const baseCreature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        squash: "RELU",
        bias: 0.1,
        uuid: "neuron-A-connects-only-to-B",
      },
      {
        type: "hidden",
        squash: "RELU",
        bias: 0.2,
        uuid: "neuron-B-target-of-A",
      },
      {
        type: "hidden",
        squash: "RELU",
        bias: 0.3,
        uuid: "neuron-C-independent",
      },
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      // A connects only to B (so A becomes orphaned when B is removed)
      {
        fromUUID: "input-0",
        toUUID: "neuron-A-connects-only-to-B",
        weight: 0.1,
      },
      {
        fromUUID: "neuron-A-connects-only-to-B",
        toUUID: "neuron-B-target-of-A",
        weight: 0.1,
      },
      // B connects to output
      { fromUUID: "neuron-B-target-of-A", toUUID: "output-0", weight: 0.1 },
      // C is independent - connects input to output
      { fromUUID: "input-1", toUUID: "neuron-C-independent", weight: 0.1 },
      { fromUUID: "neuron-C-independent", toUUID: "output-0", weight: 0.1 },
    ],
  });

  // Order matters: B first (which orphans A), then A (which fails), then C
  const discovery: DiscoverResult = {
    ID: "issue-920-test",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [
      // B is removed first - this orphans A
      {
        neuronUUID: "neuron-B-target-of-A",
        totalError: 0.001,
        impact: 1e-10,
        reason: "Low impact",
      },
      // A is removed second - should fail because it was already removed by orphan cleanup
      {
        neuronUUID: "neuron-A-connects-only-to-B",
        totalError: 0.001,
        impact: 1e-10,
        reason: "Low impact",
      },
      // C is independent and should still be removed
      {
        neuronUUID: "neuron-C-independent",
        totalError: 0.001,
        impact: 1e-10,
        reason: "Low impact",
      },
    ],
    candidateSquashes: undefined,
  };

  // Phase 1: build single removal candidates only.
  const singleCandidates = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });

  const removalCandidates = singleCandidates.filter(
    (c) => c.change.type === "remove-low-impact",
  );

  // We should have 3 single removal candidates (no combined candidates in Phase 1).
  assertEquals(
    removalCandidates.length,
    3,
    `Should create 3 single removal candidates, got ${removalCandidates.length}`,
  );

  // Phase 2: pretend these were "successful" and build combinations.
  const combinedCandidates = buildCombinedFromSuccessful(
    baseCreature,
    discovery.ID,
    removalCandidates,
  );

  const combinedRemovalCandidate = combinedCandidates.find(
    (c) =>
      c.change.type === "combo-successful" &&
      (c.change.description?.includes("Pruned") ?? false),
  );

  assertExists(
    combinedRemovalCandidate,
    "Should create a combined removal candidate even if one removal step becomes a no-op",
  );

  // Verify the combined candidate removed B and C (A may also be removed as an orphan).
  const combinedExport = combinedRemovalCandidate.creature.exportJSON();
  for (
    const removedUUID of [
      "neuron-B-target-of-A",
      "neuron-A-connects-only-to-B",
      "neuron-C-independent",
    ]
  ) {
    const exists = combinedExport.neurons.some((n) => n.uuid === removedUUID);
    assertEquals(
      exists,
      false,
      `${removedUUID} should be removed in combined candidate`,
    );
  }
});

/**
 * Test for issue #912: removeLowImpactNeuron should clean up memetic data
 * when removing a neuron that is referenced in the memetic weights/biases.
 *
 * Without the fix, this test would fail with:
 * "Memetic from UUID {uuid} has no valid neuron."
 */
Deno.test("removeLowImpactNeuron cleans up memetic data for removed neuron", () => {
  // Create a creature with memetic data that references the neuron we'll remove
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        squash: "RELU",
        bias: 0.5,
        uuid: "hidden-with-memetic",
      },
      { type: "output", squash: "IDENTITY", bias: 0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-with-memetic", weight: 0.1 },
      { fromUUID: "hidden-with-memetic", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ],
    memetic: {
      generation: 1,
      score: 0.5,
      biases: {
        "hidden-with-memetic": 0.5,
        "output-0": 0.1,
      },
      weights: {
        "input-0": [
          { toUUID: "hidden-with-memetic", weight: 0.15 },
        ],
        "hidden-with-memetic": [
          { toUUID: "output-0", weight: 0.25 },
        ],
        "input-1": [
          { toUUID: "output-0", weight: 0.95 },
        ],
      },
    },
  });

  const candidate: RemovalCandidate = {
    neuronUUID: "hidden-with-memetic",
    totalError: 5.0,
    impact: 0.001, // Very low impact (0.1%)
    reason: "High error but very low impact - far from outputs",
  };

  // This should NOT throw a MEMETIC validation error
  const result = DiscoverStructure.removeLowImpactNeuron(
    "test-memetic-cleanup",
    creature,
    candidate,
  );

  assertExists(result, "Should return a modified creature");

  // Verify the neuron was removed
  const hiddenNeurons = result.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length, 0, "Hidden neuron should be removed");

  // Memetic data should be cleaned up (either deleted entirely or have references removed)
  // The cleanupMemeticForRemovedNeuron function deletes the entire memetic object
  assertEquals(
    result.memetic,
    undefined,
    "Memetic data should be deleted when referencing neuron is removed",
  );
});
