/**
 * Issue #2005: Discovery operations must not crash when Creature.fromJSON
 * encounters an unresolvable neuron ID.
 *
 * The discovery pipeline modifies exported JSON (adding/removing neurons and
 * synapses) before calling Creature.fromJSON. If the modified JSON is invalid
 * (e.g., a synapse references a neuron ID that doesn't exist), the operation
 * should return undefined/null gracefully instead of crashing the process with
 * an uncaught AssertionError.
 */

import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import {
  addHelpfulNeurons,
  addHelpfulSynapses,
  changeSquash,
  removeHarmfulNeuron,
  removeLowImpactNeuron,
  removeSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoveryApplication.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import {
  buildSingleNeuronCandidates,
  buildSingleSynapseCandidates,
} from "../../src/discovery/CandidateCreation.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Creates a minimal valid creature for testing.
 *
 * Structure: input(0) -> hidden(1000000) -> output(-1)
 *            input(1) -> hidden(1000001) -> output(-1)
 */
function makeTestCreature(): Creature {
  const exportJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        id: 1000000,
        squash: IDENTITY.NAME,
        bias: 0.1,
      },
      {
        type: "hidden",
        id: 1000001,
        squash: IDENTITY.NAME,
        bias: 0.2,
      },
      {
        type: "output",
        id: -1,
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromId: 0, toId: 1000000, weight: 0.5 },
      { fromId: 1, toId: 1000001, weight: 0.3 },
      { fromId: 1000000, toId: -1, weight: 0.75 },
      { fromId: 1000001, toId: -1, weight: 0.25 },
    ],
  };

  return Creature.fromJSON(exportJSON);
}

Deno.test(
  "addHelpfulSynapses returns undefined for non-existent source neuron ID",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    // Candidate references a neuron ID that doesn't exist in the creature
    const candidate: CandidateSynapse = {
      fromNeuronId: 9999999, // Non-existent neuron
      toNeuronId: -1,
      weight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = addHelpfulSynapses("test-id", creature, [candidate]);
    assertEquals(
      result,
      undefined,
      "Should return undefined for non-existent source neuron",
    );
  },
);

Deno.test(
  "addHelpfulSynapses returns undefined for non-existent target neuron ID",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    // Candidate references a target neuron ID that doesn't exist
    const candidate: CandidateSynapse = {
      fromNeuronId: 0, // Valid input neuron
      toNeuronId: 9999999, // Non-existent target neuron
      weight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = addHelpfulSynapses("test-id", creature, [candidate]);
    assertEquals(
      result,
      undefined,
      "Should return undefined for non-existent target neuron",
    );
  },
);

Deno.test(
  "addHelpfulNeurons returns undefined for non-existent source neuron ID",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateNeuron = {
      fromNeuronId: 9999999, // Non-existent neuron
      toNeuronId: -1,
      squash: IDENTITY.NAME,
      bias: 0.1,
      incomingWeight: 0.5,
      outgoingWeight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = addHelpfulNeurons("test-id", creature, [candidate]);
    assertEquals(
      result,
      undefined,
      "Should return undefined for non-existent source neuron",
    );
  },
);

Deno.test(
  "removeSynapse returns null for non-existent source neuron",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateSynapse = {
      fromNeuronId: 9999999,
      toNeuronId: -1,
      weight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = removeSynapse("test-id", creature, candidate);
    assertEquals(
      result,
      null,
      "Should return null for non-existent neuron",
    );
  },
);

Deno.test(
  "removeHarmfulNeuron returns undefined for non-existent neuron",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateHarmfulNeuron = {
      neuronId: 9999999,
      errorMagnitude: 0.5,
      averageActivation: 0.1,
      sampleCount: 10,
      expectedCreatureScoreGain: 0.01,
    };

    const result = removeHarmfulNeuron("test-id", creature, candidate);
    assertEquals(
      result,
      undefined,
      "Should return undefined for non-existent neuron",
    );
  },
);

Deno.test(
  "changeSquash returns undefined for non-existent neuron",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateSquash = {
      neuronId: 9999999,
      previousSquash: IDENTITY.NAME,
      squash: "LOGISTIC",
      expectedCreatureScoreGain: 0.01,
      improvedError: 0.005,
      currentError: 0.01,
    };

    const result = changeSquash("test-id", creature, [candidate]);
    assertEquals(
      result,
      undefined,
      "Should return undefined for non-existent neuron",
    );
  },
);

Deno.test(
  "removeLowImpactNeuron returns undefined for non-existent neuron",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate = {
      neuronId: 9999999,
      impact: 0.001,
      totalError: 0.01,
      reason: "low_impact",
      meanActivation: 0.0,
    };

    const result = removeLowImpactNeuron("test-id", creature, candidate);
    assertEquals(
      result,
      undefined,
      "Should return undefined for non-existent neuron",
    );
  },
);

Deno.test(
  "Creature.fromJSON provides diagnostic info when synapse references missing neuron",
  async () => {
    await initWasmForTests();

    // Create a CreatureExport with a synapse referencing a non-existent neuron
    const badExport: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          id: 1000000,
          squash: IDENTITY.NAME,
          bias: 0.1,
        },
        {
          type: "output",
          id: -1,
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromId: 0, toId: 1000000, weight: 0.5 },
        { fromId: 1000000, toId: -1, weight: 0.75 },
        // This synapse references a neuron (9999999) that doesn't exist
        { fromId: 9999999, toId: -1, weight: 0.5 },
      ],
    };

    let errorMessage = "";
    try {
      Creature.fromJSON(badExport);
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    // Verify the error message includes diagnostic info (fromId value)
    assertEquals(
      errorMessage.includes("FROM is undefined"),
      true,
      `Error should mention FROM is undefined, got: ${errorMessage}`,
    );
    assertEquals(
      errorMessage.includes("9999999"),
      true,
      `Error should include the bad fromId value, got: ${errorMessage}`,
    );
  },
);

Deno.test(
  "buildSingleSynapseCandidates gracefully skips invalid candidates",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidates: CandidateSynapse[] = [
      {
        fromNeuronId: 9999999, // Non-existent — should be skipped
        toNeuronId: -1,
        weight: 0.5,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.01,
        expectedCreatureScoreGain: 0.01,
        improvedCount: 5,
        totalCount: 10,
      },
      {
        fromNeuronId: 0, // Valid — but target doesn't exist
        toNeuronId: 9999999,
        weight: 0.5,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.01,
        expectedCreatureScoreGain: 0.01,
        improvedCount: 5,
        totalCount: 10,
      },
    ];

    // This should NOT throw — it should skip invalid candidates gracefully
    const results = buildSingleSynapseCandidates(
      "test-id",
      creature,
      candidates,
    );
    assertEquals(results.length, 0, "All invalid candidates should be skipped");
  },
);

Deno.test(
  "buildSingleNeuronCandidates gracefully skips invalid candidates",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidates: CandidateNeuron[] = [
      {
        fromNeuronId: 9999999, // Non-existent — should be skipped
        toNeuronId: -1,
        squash: IDENTITY.NAME,
        bias: 0.1,
        incomingWeight: 0.5,
        outgoingWeight: 0.5,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.01,
        expectedCreatureScoreGain: 0.01,
        improvedCount: 5,
        totalCount: 10,
      },
    ];

    // This should NOT throw — it should skip invalid candidates gracefully
    const results = buildSingleNeuronCandidates(
      "test-id",
      creature,
      candidates,
    );
    assertEquals(results.length, 0, "All invalid candidates should be skipped");
  },
);
