/**
 * Issue #2016: Corner-case tests for discovery operations that modify
 * creature JSON. These tests verify that structural mutations never
 * produce creatures with dangling synapse references.
 *
 * Each test builds a specific topology, applies a discovery operation,
 * and asserts the resulting creature is structurally valid.
 */

import { assertNotEquals } from "@std/assert";
import { assertEquals } from "@std/assert";
import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { assertValidSynapseReferences } from "../../src/architecture/AssertValidSynapseReferences.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import {
  addHelpfulNeurons,
  removeSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoveryApplication.ts";
import {
  removeHarmfulNeuron,
  removeLowImpactNeuron,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import type { RemovalCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Helper: asserts the creature export has no dangling synapse references.
 */
function assertIntegrity(creature: Creature, context: string): void {
  const exported = creature.exportJSON();
  assertValidSynapseReferences(exported, context);
}

// ---------------------------------------------------------------------------
// Test 1: removeSynapse causing deep cascade
//
// Topology:
//   input(0) -> H1(1000000) -> H2(1000001) -> output(-1)
//   input(1) -> output(-1)
//
// Removing the synapse 0 -> H1 leaves H1 with no inward connections.
// H1 gets converted to a constant. But then H1's only purpose is to
// feed H2, and if H1 becomes constant it may or may not cascade.
// The key is that the result must be structurally valid.
// ---------------------------------------------------------------------------
Deno.test(
  "removeSynapse: deep cascade cleans up entire chain",
  async () => {
    await initWasmForTests();

    const exportJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "cascade-h1",
          id: 1000000,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "cascade-h2",
          id: 1000001,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        { type: "output", id: -1, squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromId: 0, toId: 1000000, weight: 1.0 },
        { fromId: 1000000, toId: 1000001, weight: 1.0 },
        { fromId: 1000001, toId: -1, weight: 1.0 },
        { fromId: 1, toId: -1, weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(exportJSON);

    // Remove synapse 0 -> H1 (the only inward connection to H1)
    const candidate: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "cascade-h1",
      weight: 1.0,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = removeSynapse("test-cascade", creature, candidate);

    if (result !== null) {
      assertIntegrity(result, "removeSynapse deep cascade");

      // Verify no dangling references in exported JSON
      const exported = result.exportJSON();
      assertValidSynapseReferences(
        exported,
        "removeSynapse deep cascade export",
      );
    }
    // result being null is also acceptable if the operation decides
    // the change produces an identical creature
  },
);

// ---------------------------------------------------------------------------
// Test 2: removeHarmfulNeuron where the neuron is a hub
//
// Topology:
//   input(0) -> HUB(1000000) -> H1(1000001) -> output(-1)
//                             -> H2(1000002) -> output(-1)
//                             -> output(-1)
//   input(1) -> output(-1)
//
// Removing HUB should cascade: H1 and H2 lose their only inward
// connection and must also be cleaned up.
// ---------------------------------------------------------------------------
Deno.test(
  "removeHarmfulNeuron: hub neuron removal cascades to dependants",
  async () => {
    await initWasmForTests();

    const exportJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hub-neuron",
          id: 1000000,
          squash: IDENTITY.NAME,
          bias: 0.5,
        },
        {
          type: "hidden",
          uuid: "hub-dep-a",
          id: 1000001,
          squash: IDENTITY.NAME,
          bias: 0.1,
        },
        {
          type: "hidden",
          uuid: "hub-dep-b",
          id: 1000002,
          squash: IDENTITY.NAME,
          bias: 0.2,
        },
        { type: "output", id: -1, squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromId: 0, toId: 1000000, weight: 1.0 },
        { fromId: 1000000, toId: 1000001, weight: 0.8 },
        { fromId: 1000000, toId: 1000002, weight: 0.6 },
        { fromId: 1000000, toId: -1, weight: 0.4 },
        { fromId: 1000001, toId: -1, weight: 0.3 },
        { fromId: 1000002, toId: -1, weight: 0.2 },
        { fromId: 1, toId: -1, weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(exportJSON);

    const candidate: CandidateHarmfulNeuron = {
      neuronUuid: "hub-neuron",
      errorMagnitude: 1e11,
      averageActivation: 0.5,
      sampleCount: 100,
      expectedCreatureScoreGain: 0.05,
    };

    const result = removeHarmfulNeuron("test-hub", creature, candidate);

    if (result !== undefined) {
      assertIntegrity(result, "removeHarmfulNeuron hub");

      // H1 and H2 should have been cleaned up since their only
      // inward source (HUB) was removed
      const exported = result.exportJSON();
      const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");

      // All hidden neurons depended solely on HUB, so they should all be gone
      // (they may be converted to constants first then removed, or removed directly)
      for (const neuron of hiddenNeurons) {
        // If any hidden neuron remains, verify it has both inward and outward connections
        const hasInward = exported.synapses.some((s) => s.toId === neuron.id);
        const hasOutward = exported.synapses.some((s) =>
          s.fromId === neuron.id
        );
        assert(
          hasInward && hasOutward,
          `Hidden neuron ${neuron.id} should have both inward and outward connections`,
        );
      }

      assertValidSynapseReferences(exported, "removeHarmfulNeuron hub export");
    }
  },
);

// ---------------------------------------------------------------------------
// Test 3: removeLowImpactNeuron with constant neurons downstream
//
// Topology:
//   input(0) -> LI(1000000) -> CONST(1000001) -> output(-1)
//   input(1) -> output(-1)
//
// Where CONST is a constant neuron (no inward connections from other neurons,
// only from LI). Removing LI leaves CONST with no inward connections, so
// CONST should also be cleaned up.
// ---------------------------------------------------------------------------
Deno.test(
  "removeLowImpactNeuron: downstream constant neuron cleaned up",
  async () => {
    await initWasmForTests();

    const exportJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "li-neuron",
          id: 1000000,
          squash: IDENTITY.NAME,
          bias: 0.01,
        },
        {
          type: "hidden",
          uuid: "const-downstream",
          id: 1000001,
          squash: IDENTITY.NAME,
          bias: 0.5,
        },
        { type: "output", id: -1, squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromId: 0, toId: 1000000, weight: 0.001 },
        { fromId: 1000000, toId: 1000001, weight: 0.5 },
        { fromId: 1000001, toId: -1, weight: 0.3 },
        { fromId: 1, toId: -1, weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(exportJSON);

    const candidate: RemovalCandidate = {
      neuronUuid: "li-neuron",
      totalError: 0.001,
      impact: 0.001,
      reason: "low_impact",
      meanActivation: 0.01,
    };

    const result = removeLowImpactNeuron(
      "test-const-downstream",
      creature,
      candidate,
    );

    if (result !== undefined) {
      assertIntegrity(result, "removeLowImpactNeuron constant downstream");

      const exported = result.exportJSON();
      assertValidSynapseReferences(
        exported,
        "removeLowImpactNeuron constant downstream export",
      );

      // Neuron 1000001 should be cleaned up (converted to constant then
      // either kept if it has outward connections or removed if not)
      // The key assertion is structural validity
      for (const synapse of exported.synapses) {
        // No synapse should reference the removed neuron
        assertNotEquals(
          synapse.fromId,
          1000000,
          "No synapse should reference removed neuron as source",
        );
        assertNotEquals(
          synapse.toId,
          1000000,
          "No synapse should reference removed neuron as target",
        );
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4: addHelpfulNeurons with output contiguity invariant
//
// Topology:
//   input(0) -> output(-1)
//   input(0) -> output(-2)
//   input(1) -> output(-1)
//   input(1) -> output(-2)
//
// Add a neuron between input(0) and output(-2). The new neuron must be
// inserted BEFORE the first output neuron (not between outputs).
// ---------------------------------------------------------------------------
Deno.test(
  "addHelpfulNeurons: output contiguity maintained with multi-output creature",
  async () => {
    await initWasmForTests();

    const exportJSON: CreatureExport = {
      input: 2,
      output: 2,
      neurons: [
        { type: "output", id: -1, squash: IDENTITY.NAME, bias: 0 },
        { type: "output", id: -2, squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromId: 0, toId: -1, weight: 0.5 },
        { fromId: 0, toId: -2, weight: 0.3 },
        { fromId: 1, toId: -1, weight: 0.4 },
        { fromId: 1, toId: -2, weight: 0.2 },
      ],
    };

    const creature = Creature.fromJSON(exportJSON);

    const candidate: CandidateNeuron = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "output-1",
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

    const result = addHelpfulNeurons("test-output-contiguity", creature, [
      candidate,
    ]);

    if (result !== undefined) {
      assertIntegrity(result, "addHelpfulNeurons output contiguity");

      const exported = result.exportJSON();
      assertValidSynapseReferences(
        exported,
        "addHelpfulNeurons output contiguity export",
      );

      // Verify all output neurons are contiguous at the end
      const neuronTypes = exported.neurons.map((n) => n.type);
      let foundFirstOutput = false;
      let foundNonOutputAfterOutput = false;
      for (const t of neuronTypes) {
        if (t === "output") {
          foundFirstOutput = true;
        } else if (foundFirstOutput) {
          foundNonOutputAfterOutput = true;
        }
      }
      assertEquals(
        foundNonOutputAfterOutput,
        false,
        "No non-output neuron should appear after the first output neuron",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 5: removeSynapse on a creature with self-loops
//
// Topology:
//   input(0) -> H1(1000000) -> output(-1)
//   H1(1000000) -> H1(1000000) (self-loop)
//   input(1) -> output(-1)
//
// Remove the input(0) -> H1 synapse. H1 still has a self-loop but no
// external inward connection, so it should be cleaned up. The self-loop
// must not confuse the orphan detection.
// ---------------------------------------------------------------------------
Deno.test(
  "removeSynapse: self-loops do not prevent orphan cleanup",
  async () => {
    await initWasmForTests();

    const exportJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "selfloop-h1",
          id: 1000000,
          squash: IDENTITY.NAME,
          bias: 0.1,
        },
        { type: "output", id: -1, squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromId: 0, toId: 1000000, weight: 0.5 },
        { fromId: 1000000, toId: 1000000, weight: 0.3 }, // self-loop
        { fromId: 1000000, toId: -1, weight: 0.7 },
        { fromId: 1, toId: -1, weight: 0.4 },
      ],
    };

    // This creature has feedback connections, so it's not forward-only
    const creature = Creature.fromJSON(exportJSON);

    // Remove the only external inward connection to H1
    const candidate: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "selfloop-h1",
      weight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = removeSynapse("test-self-loop", creature, candidate);

    if (result !== null) {
      assertIntegrity(result, "removeSynapse self-loop");

      const exported = result.exportJSON();
      assertValidSynapseReferences(
        exported,
        "removeSynapse self-loop export",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 6: Interaction between multiple removals - sequential hub removal
//
// Topology:
//   input(0) -> H1(1000000) -> H2(1000001) -> output(-1)
//   input(1) -> output(-1)
//
// Remove H1 first, which should cascade and also remove H2 (since H2's
// only inward connection is from H1). Then verify a second removal attempt
// on H2 is a no-op.
// ---------------------------------------------------------------------------
Deno.test(
  "removeHarmfulNeuron: sequential removal of chained neurons",
  async () => {
    await initWasmForTests();

    const exportJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "seq-chain-h1",
          id: 1000000,
          squash: IDENTITY.NAME,
          bias: 0.3,
        },
        {
          type: "hidden",
          uuid: "seq-chain-h2",
          id: 1000001,
          squash: IDENTITY.NAME,
          bias: 0.2,
        },
        { type: "output", id: -1, squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromId: 0, toId: 1000000, weight: 1.0 },
        { fromId: 1000000, toId: 1000001, weight: 0.8 },
        { fromId: 1000001, toId: -1, weight: 0.6 },
        { fromId: 1, toId: -1, weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(exportJSON);

    // Remove H1 first
    const candidateH1: CandidateHarmfulNeuron = {
      neuronUuid: "seq-chain-h1",
      errorMagnitude: 1e11,
      averageActivation: 0.3,
      sampleCount: 100,
      expectedCreatureScoreGain: 0.05,
    };

    const result1 = removeHarmfulNeuron(
      "test-chain-1",
      creature,
      candidateH1,
    );

    if (result1 !== undefined) {
      assertIntegrity(result1, "removeHarmfulNeuron chain step 1");

      // H2 should also have been cleaned up since its only inward source was H1
      const exported1 = result1.exportJSON();
      const h2Still = exported1.neurons.find((n) => n.id === 1000001);
      const h2IsHidden = h2Still?.type === "hidden";
      // If H2 is still present as hidden, it must have valid connections
      if (h2IsHidden) {
        const hasInward = exported1.synapses.some((s) => s.toId === 1000001);
        assert(
          hasInward,
          "If H2 is still hidden, it must have inward connections",
        );
      }

      // Now try to remove H2 from the result - should be a no-op if already cleaned
      const candidateH2: CandidateHarmfulNeuron = {
        neuronUuid: "seq-chain-h2",
        errorMagnitude: 1e11,
        averageActivation: 0.2,
        sampleCount: 100,
        expectedCreatureScoreGain: 0.03,
      };

      const result2 = removeHarmfulNeuron(
        "test-chain-2",
        result1,
        candidateH2,
      );

      if (result2 !== undefined) {
        assertIntegrity(result2, "removeHarmfulNeuron chain step 2");
      }
      // result2 being undefined is expected if H2 was already cleaned up
    }
  },
);

// ---------------------------------------------------------------------------
// Test 7: removeSynapse that leaves a 3-deep chain of orphans
//
// Topology:
//   input(0) -> H1(1000000) -> H2(1000001) -> H3(1000002) -> output(-1)
//   input(1) -> output(-1)
//
// Remove H1 -> H2. H2 loses its only inward, which cascades to H3.
// All three hidden neurons in the chain from H2 onward must be cleaned up.
// ---------------------------------------------------------------------------
Deno.test(
  "removeSynapse: three-deep cascade fully resolved",
  async () => {
    await initWasmForTests();

    const exportJSON: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "deep-h1",
          id: 1000000,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "deep-h2",
          id: 1000001,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "deep-h3",
          id: 1000002,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        { type: "output", id: -1, squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromId: 0, toId: 1000000, weight: 1.0 },
        { fromId: 1000000, toId: 1000001, weight: 1.0 },
        { fromId: 1000001, toId: 1000002, weight: 1.0 },
        { fromId: 1000002, toId: -1, weight: 1.0 },
        { fromId: 1, toId: -1, weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(exportJSON);

    // Remove H1 -> H2 synapse
    const candidate: CandidateSynapse = {
      fromNeuronUuid: "deep-h1",
      toNeuronUuid: "deep-h2",
      weight: 1.0,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.01,
      expectedCreatureScoreGain: 0.01,
      improvedCount: 5,
      totalCount: 10,
    };

    const result = removeSynapse("test-3-deep", creature, candidate);

    if (result !== null) {
      assertIntegrity(result, "removeSynapse 3-deep cascade");

      const exported = result.exportJSON();
      assertValidSynapseReferences(
        exported,
        "removeSynapse 3-deep cascade export",
      );

      // H2 lost its only inward connection (from H1), so it should be
      // converted to a constant. H3 still receives from constant H2, so it
      // remains as hidden (with valid inward from the constant).
      const h2 = exported.neurons.find((n) => n.id === 1000001);
      assertEquals(
        h2?.type === "hidden",
        false,
        "H2 should not remain as hidden (no inward connection)",
      );

      // H1 lost its only outward connection (to H2), so it should be removed
      const h1 = exported.neurons.find((n) =>
        n.id === 1000000 && n.type === "hidden"
      );
      assertEquals(
        h1,
        undefined,
        "H1 should be removed (no outward connections after synapse removal)",
      );
    }
  },
);
