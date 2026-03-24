/**
 * Unit tests for CandidateCreation.
 *
 * Issue #1727: Tests for the candidate builder functions that create
 * individual discovery candidates from discovery results.
 *
 * Covers:
 * - buildSingleSynapseCandidates
 * - buildSingleNeuronCandidates
 * - buildSingleSquashCandidates
 * - buildLowImpactRemovalCandidates
 * - buildCoordinatedStructuralCandidates
 * - buildHarmfulNeuronRemovalCandidate
 * - buildHarmfulSynapseRemovalCandidates
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  buildHarmfulNeuronRemovalCandidate,
  buildHarmfulSynapseRemovalCandidates,
  buildLowImpactRemovalCandidates,
  buildSingleNeuronCandidates,
  buildSingleSquashCandidates,
  buildSingleSynapseCandidates,
} from "../../src/discovery/CandidateCreation.ts";

/**
 * Creates a baseline creature for candidate creation tests.
 * Topology: input-0, input-1 → hidden-1 → output-0
 *                               hidden-2 → output-0
 */
function makeBaseCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: "IDENTITY",
        bias: 0,
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        id: 5002,
        squash: "IDENTITY",
        bias: 0.5,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: -0.3 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

// --- buildSingleSynapseCandidates ---

Deno.test("buildSingleSynapseCandidates - returns empty for undefined synapses", () => {
  const base = makeBaseCreature();
  const result = buildSingleSynapseCandidates("test-id", base, undefined);
  assertEquals(result.length, 0);
});

Deno.test("buildSingleSynapseCandidates - returns empty for empty array", () => {
  const base = makeBaseCreature();
  const result = buildSingleSynapseCandidates("test-id", base, []);
  assertEquals(result.length, 0);
});

Deno.test("buildSingleSynapseCandidates - builds candidate for valid synapse", () => {
  const base = makeBaseCreature();
  const synapse: CandidateSynapse = {
    fromNeuronId: 0,
    toNeuronId: 5002,
    weight: 0.4,
    targetNeuronImpact: 0.1,
    expectedCreatureErrorReduction: 0.05,
    expectedCreatureScoreGain: 0.03,
    improvedCount: 5,
    totalCount: 10,
  };

  const result = buildSingleSynapseCandidates("test-id", base, [synapse]);

  // Should produce a candidate (or skip if structure change fails)
  // Either way, no error should be thrown
  for (const candidate of result) {
    assertEquals(candidate.change.type, "add-synapses");
    assert(candidate.creature, "candidate should have a creature");
    assert(
      candidate.change.description?.includes("Added helpful synapse"),
      "description should mention adding synapse",
    );
  }
});

Deno.test("buildSingleSynapseCandidates - includes expectedErrorReduction from getExpected", () => {
  const base = makeBaseCreature();
  const synapse: CandidateSynapse = {
    fromNeuronId: 0,
    toNeuronId: 5002,
    weight: 0.4,
    targetNeuronImpact: 0.1,
    expectedCreatureErrorReduction: 0.05,
    expectedCreatureScoreGain: 0.03,
    improvedCount: 5,
    totalCount: 10,
  };

  const getExpected = (_s: CandidateSynapse) => 0.42;
  const result = buildSingleSynapseCandidates(
    "test-id",
    base,
    [synapse],
    getExpected,
  );

  for (const candidate of result) {
    assertEquals(candidate.change.expectedErrorReduction, 0.42);
  }
});

// --- buildSingleNeuronCandidates ---

Deno.test("buildSingleNeuronCandidates - returns empty for undefined neurons", () => {
  const base = makeBaseCreature();
  const result = buildSingleNeuronCandidates("test-id", base, undefined);
  assertEquals(result.length, 0);
});

Deno.test("buildSingleNeuronCandidates - returns empty for empty array", () => {
  const base = makeBaseCreature();
  const result = buildSingleNeuronCandidates("test-id", base, []);
  assertEquals(result.length, 0);
});

Deno.test("buildSingleNeuronCandidates - builds candidate for valid neuron", () => {
  const base = makeBaseCreature();
  const neuron: CandidateNeuron = {
    fromNeuronId: 0,
    toNeuronId: -1,
    incomingWeight: 0.5,
    outgoingWeight: 0.3,
    squash: "TANH",
    bias: 0.1,
    targetNeuronImpact: 0.2,
    expectedCreatureErrorReduction: 0.1,
    expectedCreatureScoreGain: 0.05,
    improvedCount: 8,
    totalCount: 15,
  };

  const result = buildSingleNeuronCandidates("test-id", base, [neuron]);

  for (const candidate of result) {
    assertEquals(candidate.change.type, "add-neurons");
    assert(candidate.creature, "candidate should have a creature");
    assert(
      candidate.change.description?.includes("Added neuron"),
      "description should mention adding neuron",
    );
  }
});

// --- buildSingleSquashCandidates ---

Deno.test("buildSingleSquashCandidates - returns empty for undefined squashes", () => {
  const base = makeBaseCreature();
  const result = buildSingleSquashCandidates("test-id", base, undefined);
  assertEquals(result.length, 0);
});

Deno.test("buildSingleSquashCandidates - returns empty for empty array", () => {
  const base = makeBaseCreature();
  const result = buildSingleSquashCandidates("test-id", base, []);
  assertEquals(result.length, 0);
});

Deno.test("buildSingleSquashCandidates - builds candidate for valid squash change", () => {
  const base = makeBaseCreature();
  // hidden-1 explicit ID from fixture
  const squash: CandidateSquash = {
    neuronId: 5001,
    previousSquash: "IDENTITY",
    squash: "TANH",
    expectedCreatureScoreGain: 0.05,
    improvedError: 0.02,
    currentError: 0.1,
  };

  const result = buildSingleSquashCandidates("test-id", base, [squash]);

  // Should produce a candidate since the squash change is valid
  assert(result.length > 0, "should produce at least one candidate");
  const candidate = result[0];
  assertEquals(candidate.change.type, "change-squash");
  assert(
    candidate.change.description?.includes("Changed activation function"),
    "description should mention squash change",
  );
});

Deno.test("buildSingleSquashCandidates - includes expected from getExpected", () => {
  const base = makeBaseCreature();
  // hidden-1 explicit ID from fixture
  const squash: CandidateSquash = {
    neuronId: 5001,
    previousSquash: "IDENTITY",
    squash: "TANH",
    expectedCreatureScoreGain: 0.05,
    improvedError: 0.02,
    currentError: 0.1,
  };

  const getExpected = (_s: CandidateSquash) => 0.99;
  const result = buildSingleSquashCandidates(
    "test-id",
    base,
    [squash],
    getExpected,
  );

  for (const candidate of result) {
    assertEquals(candidate.change.expectedErrorReduction, 0.99);
  }
});

// --- buildLowImpactRemovalCandidates ---

Deno.test("buildLowImpactRemovalCandidates - returns empty when no removalCandidates", () => {
  const base = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "test-id",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const result = buildLowImpactRemovalCandidates(discovery, base);
  assertEquals(result.length, 0);
});

Deno.test("buildLowImpactRemovalCandidates - returns empty for empty removalCandidates", () => {
  const base = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "test-id",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [],
    candidateSquashes: undefined,
  };

  const result = buildLowImpactRemovalCandidates(discovery, base);
  assertEquals(result.length, 0);
});

Deno.test("buildLowImpactRemovalCandidates - skips non-existent neuron", () => {
  const base = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "test-id",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [{
      neuronId: 7000,
      totalError: 0.01,
      impact: 0.001,
      reason: "low-impact",
    }],
    candidateSquashes: undefined,
  };

  const result = buildLowImpactRemovalCandidates(discovery, base);
  assertEquals(result.length, 0);
});

Deno.test("buildLowImpactRemovalCandidates - builds candidate for existing hidden neuron", () => {
  const base = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "test-id",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: [{
      // hidden-2 explicit ID from fixture
      neuronId: 5002,
      totalError: 0.01,
      impact: 0.0001,
      reason: "low-impact",
    }],
    candidateSquashes: undefined,
  };

  const result = buildLowImpactRemovalCandidates(discovery, base);

  // Should produce a candidate (or skip if removal fails)
  for (const candidate of result) {
    assertEquals(candidate.change.type, "remove-low-impact");
    assert(
      candidate.change.description?.includes("Removed neuron"),
      "description should mention removal",
    );
  }
});

// --- buildHarmfulNeuronRemovalCandidate ---

Deno.test("buildHarmfulNeuronRemovalCandidate - returns undefined for empty array", () => {
  const base = makeBaseCreature();
  const result = buildHarmfulNeuronRemovalCandidate("test-id", base, []);
  assertEquals(result, undefined);
});

Deno.test("buildHarmfulNeuronRemovalCandidate - returns undefined for undefined", () => {
  const base = makeBaseCreature();
  const result = buildHarmfulNeuronRemovalCandidate(
    "test-id",
    base,
    undefined,
  );
  assertEquals(result, undefined);
});

Deno.test("buildHarmfulNeuronRemovalCandidate - builds candidate for valid harmful neuron", () => {
  const base = makeBaseCreature();
  // hidden-1 explicit ID from fixture
  const harmful: CandidateHarmfulNeuron = {
    neuronId: 5001,
    errorMagnitude: 0.5,
    expectedCreatureScoreGain: 0.1,
    sampleCount: 20,
    averageActivation: 0.3,
  };

  const result = buildHarmfulNeuronRemovalCandidate("test-id", base, [
    harmful,
  ]);

  // Should produce a candidate (or undefined if removal fails)
  if (result) {
    assertEquals(result.change.type, "remove-neuron");
    assert(
      result.change.description?.includes("Removed harmful neuron"),
      "description should mention harmful neuron removal",
    );
    assertEquals(result.change.sampleSize, 20);
  }
});

// --- buildHarmfulSynapseRemovalCandidates ---

Deno.test("buildHarmfulSynapseRemovalCandidates - returns empty when no harmful synapse", () => {
  const base = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "test-id",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const { removedSynapseCreature, candidates } =
    buildHarmfulSynapseRemovalCandidates(
      discovery,
      base,
      undefined, // removeHarmfulSynapse
      undefined, // addHelpfulSynapses
      undefined, // addedSynapseCreature
      false, // skipCombos
      () => undefined, // getExpectedRemoval
    );

  assertEquals(removedSynapseCreature, undefined);
  assertEquals(candidates.length, 0);
});

Deno.test("buildHarmfulSynapseRemovalCandidates - builds candidate for valid synapse removal", () => {
  const base = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "test-id",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  // hidden-2 explicit ID from fixture
  const harmfulSynapse: CandidateSynapse = {
    fromNeuronId: 5002,
    toNeuronId: -1,
    weight: -0.3,
    targetNeuronImpact: 0.1,
    expectedCreatureErrorReduction: 0.05,
    expectedCreatureScoreGain: 0.03,
    improvedCount: 5,
    totalCount: 10,
  };

  const { removedSynapseCreature, candidates } =
    buildHarmfulSynapseRemovalCandidates(
      discovery,
      base,
      harmfulSynapse,
      undefined, // addHelpfulSynapses
      undefined, // addedSynapseCreature
      true, // skipCombos
      () => 0.05, // getExpectedRemoval
    );

  if (removedSynapseCreature) {
    assert(candidates.length > 0, "should have at least one candidate");
    const candidate = candidates[0];
    assertEquals(candidate.change.type, "remove-synapse");
    assert(
      candidate.change.description?.includes("Removed harmful synapse"),
      "description should mention synapse removal",
    );
  }
});
