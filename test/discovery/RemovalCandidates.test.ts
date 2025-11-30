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
import { buildDiscoveryCandidates } from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";

Deno.test("removeLowImpactNeuron removes neuron without bias adjustment", () => {
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

Deno.test("buildDiscoveryCandidates sets expectedErrorReduction to costOfGrowth for removal candidates", () => {
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

  const costOfGrowth = 1e-7;

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

  // Pass costOfGrowth to buildDiscoveryCandidates
  const candidates = buildDiscoveryCandidates(
    baseCreature,
    discovery,
    costOfGrowth,
  );

  const lowImpactCandidates = candidates.filter(
    (c) => c.change.type === "remove-low-impact",
  );

  assertEquals(
    lowImpactCandidates.length,
    1,
    "Should create one low-impact removal candidate",
  );

  const candidate = lowImpactCandidates[0];

  // Verify expectedErrorReduction is set to costOfGrowth
  assertEquals(
    candidate.change.expectedErrorReduction,
    costOfGrowth,
    "Expected error reduction should equal costOfGrowth",
  );
});

Deno.test("buildDiscoveryCandidates uses crippled-removal.json for near-zero weight neuron removal", async () => {
  // Load the test creature with near-zero weight synapses
  const jsonPath = new URL("../data/crippled-removal.json", import.meta.url);
  const jsonText = await Deno.readTextFile(jsonPath);
  const creatureJSON = JSON.parse(jsonText);
  const baseCreature = Creature.fromJSON(creatureJSON);

  const costOfGrowth = 1e-7;

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

  const candidates = buildDiscoveryCandidates(
    baseCreature,
    discovery,
    costOfGrowth,
  );

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

  // Verify expectedErrorReduction is set to costOfGrowth
  assertEquals(
    candidate.change.expectedErrorReduction,
    costOfGrowth,
    "Removal should improve score by costOfGrowth",
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
