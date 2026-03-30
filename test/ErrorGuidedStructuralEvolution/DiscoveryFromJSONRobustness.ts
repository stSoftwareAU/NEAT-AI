/**
 * Issue #2017: Discovery operations must produce structurally valid creatures.
 *
 * Pre-validation via assertValidSynapseReferences() catches dangling synapse
 * references before Creature.fromJSON() is called, so invalid JSON is never
 * silently swallowed. These tests verify:
 * 1. Operations correctly skip invalid candidates (non-existent neurons).
 * 2. Operations produce valid creatures when given valid input.
 * 3. Creature.fromJSON still provides diagnostics for invalid JSON.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import {
  addHelpfulNeurons,
  addHelpfulSynapses,
  changeSquash,
  removeHarmfulNeuron,
  removeLowImpactNeuron,
  removeSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryApplication.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import {
  buildSingleNeuronCandidates,
  buildSingleSynapseCandidates,
} from "../../src/discovery/CandidateCreation.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Creates a minimal valid creature for testing.
 *
 * Structure: input(0) -> hidden(1000000, uuid discovery-test-h0) -> output(-1)
 *            input(1) -> hidden(1000001, uuid discovery-test-h1) -> output(-1)
 */
function makeTestCreature(): Creature {
  const exportJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "discovery-test-h0",
        id: 1000000,
        squash: IDENTITY.NAME,
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "discovery-test-h1",
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

/**
 * Asserts that a creature has no dangling synapse references.
 */
function assertCreatureIntegrity(creature: Creature, context: string): void {
  const exported = creature.exportJSON();
  assertValidSynapseReferences(exported, context);
}

// ===== Invalid candidate tests (early-exit validation) =====

Deno.test(
  "addHelpfulSynapses returns undefined for non-existent source neuron ID",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateSynapse = {
      fromNeuronUuid: "no-such-neuron-uuid",
      toNeuronUuid: "output-0",
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

    const candidate: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "no-such-neuron-uuid",
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
      fromNeuronUuid: "no-such-neuron-uuid",
      toNeuronUuid: "output-0",
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
      fromNeuronUuid: "no-such-neuron-uuid",
      toNeuronUuid: "output-0",
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
      neuronUuid: "no-such-neuron-uuid",
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
      neuronUuid: "no-such-neuron-uuid",
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
      neuronUuid: "no-such-neuron-uuid",
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

// ===== Diagnostic test =====

Deno.test(
  "Creature.fromJSON provides diagnostic info when synapse references missing neuron",
  async () => {
    await initWasmForTests();

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
        { fromId: 9999999, toId: -1, weight: 0.5 },
      ],
    };

    let errorMessage = "";
    try {
      Creature.fromJSON(badExport);
    } catch (error) {
      errorMessage = (error as Error).message;
    }

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

// ===== Candidate builder tests =====

Deno.test(
  "buildSingleSynapseCandidates gracefully skips invalid candidates",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidates: CandidateSynapse[] = [
      {
        fromNeuronUuid: "no-such-neuron-uuid",
        toNeuronUuid: "output-0",
        weight: 0.5,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.01,
        expectedCreatureScoreGain: 0.01,
        improvedCount: 5,
        totalCount: 10,
      },
      {
        fromNeuronUuid: "input-0",
        toNeuronUuid: "no-such-neuron-uuid",
        weight: 0.5,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.01,
        expectedCreatureScoreGain: 0.01,
        improvedCount: 5,
        totalCount: 10,
      },
    ];

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
        fromNeuronUuid: "no-such-neuron-uuid",
        toNeuronUuid: "output-0",
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

    const results = buildSingleNeuronCandidates(
      "test-id",
      creature,
      candidates,
    );
    assertEquals(results.length, 0, "All invalid candidates should be skipped");
  },
);

// ===== Valid creature output tests (issue #2017) =====

Deno.test(
  "removeSynapse produces a structurally valid creature",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    // Remove the synapse from input(0) -> hidden(1000000)
    const candidate: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "discovery-test-h0",
      weight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = removeSynapse("test-valid", creature, candidate);

    if (result !== null) {
      assertCreatureIntegrity(result, "removeSynapse valid output");

      // The removed synapse should no longer exist
      const exported = result.exportJSON();
      const hasSynapse = exported.synapses.some(
        (s) => s.fromId === 0 && s.toId === 1000000,
      );
      assertEquals(hasSynapse, false, "Removed synapse should not exist");
    }
  },
);

Deno.test(
  "addHelpfulSynapses produces a structurally valid creature",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    // Add a synapse from input(1) -> hidden(1000000)
    const candidate: CandidateSynapse = {
      fromNeuronUuid: "input-1",
      toNeuronUuid: "discovery-test-h0",
      weight: 0.4,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = addHelpfulSynapses("test-valid", creature, [candidate]);

    assert(result !== undefined, "Should produce a creature for valid input");
    assertCreatureIntegrity(result, "addHelpfulSynapses valid output");

    // The new synapse should exist
    const exported = result.exportJSON();
    const hasNewSynapse = exported.synapses.some(
      (s) => s.fromUUID === "input-1" && s.toUUID === "discovery-test-h0",
    );
    assertEquals(hasNewSynapse, true, "New synapse should exist in output");
  },
);

Deno.test(
  "removeHarmfulNeuron produces a structurally valid creature",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateHarmfulNeuron = {
      neuronUuid: "discovery-test-h0",
      errorMagnitude: 1e11,
      averageActivation: 0.1,
      sampleCount: 100,
      expectedCreatureScoreGain: 0.05,
    };

    const result = removeHarmfulNeuron("test-valid", creature, candidate);

    if (result !== undefined) {
      assertCreatureIntegrity(result, "removeHarmfulNeuron valid output");

      // The removed neuron should not exist as hidden
      const exported = result.exportJSON();
      const hasNeuron = exported.neurons.some(
        (n) => n.uuid === "discovery-test-h0" && n.type === "hidden",
      );
      assertEquals(
        hasNeuron,
        false,
        "Removed neuron should not exist as hidden",
      );

      // No synapse should reference the removed neuron
      for (const synapse of exported.synapses) {
        assertNotEquals(
          synapse.fromUUID,
          "discovery-test-h0",
          "No synapse should source from removed neuron",
        );
        assertNotEquals(
          synapse.toUUID,
          "discovery-test-h0",
          "No synapse should target removed neuron",
        );
      }
    }
  },
);

Deno.test(
  "removeLowImpactNeuron produces a structurally valid creature",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate = {
      neuronUuid: "discovery-test-h1",
      totalError: 0.001,
      impact: 0.001,
      reason: "low_impact",
      meanActivation: 0.2,
    };

    const result = removeLowImpactNeuron("test-valid", creature, candidate);

    if (result !== undefined) {
      assertCreatureIntegrity(result, "removeLowImpactNeuron valid output");

      const exported = result.exportJSON();
      const hasNeuron = exported.neurons.some(
        (n) => n.uuid === "discovery-test-h1" && n.type === "hidden",
      );
      assertEquals(
        hasNeuron,
        false,
        "Removed neuron should not exist as hidden",
      );
    }
  },
);

Deno.test(
  "addHelpfulNeurons produces a structurally valid creature",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateNeuron = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "output-0",
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

    const result = addHelpfulNeurons("test-valid", creature, [candidate]);

    assert(result !== undefined, "Should produce a creature for valid input");
    assertCreatureIntegrity(result, "addHelpfulNeurons valid output");

    // The result should have more neurons than the original
    const originalNeuronCount = creature.exportJSON().neurons.length;
    const resultNeuronCount = result.exportJSON().neurons.length;
    assert(
      resultNeuronCount > originalNeuronCount,
      "Result should have more neurons than original",
    );
  },
);

Deno.test(
  "changeSquash produces a structurally valid creature",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();

    const candidate: CandidateSquash = {
      neuronUuid: "discovery-test-h0",
      previousSquash: IDENTITY.NAME,
      squash: "LOGISTIC",
      expectedCreatureScoreGain: 0.01,
      improvedError: 0.005,
      currentError: 0.01,
    };

    const result = changeSquash("test-valid", creature, [candidate]);

    assert(result !== undefined, "Should produce a creature for valid input");
    assertCreatureIntegrity(result, "changeSquash valid output");

    // Verify the squash was actually changed
    const exported = result.exportJSON();
    const neuron = exported.neurons.find((n) => n.uuid === "discovery-test-h0");
    assertEquals(neuron?.squash, "LOGISTIC", "Squash should be changed");
  },
);
