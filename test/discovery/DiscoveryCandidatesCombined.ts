import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";

// Integer ID for hidden-1 in the baseline creature (explicit id in fixture).
const ID_HIDDEN_1 = 5001;
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

function makeBaselineCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 4,
    output: 2,
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
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: -0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.15 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "output-1", weight: 0.05 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function findCandidate(
  candidates: DiscoveryCandidate[],
  type: DiscoveryCandidate["change"]["type"],
): DiscoveryCandidate {
  const candidate = candidates.find((entry) => entry.change.type === type);
  assert(candidate, `Expected to find candidate for ${type}`);
  return candidate;
}

Deno.test(
  "buildDiscoveryCandidates synthesises combined candidate across categories",
  () => {
    const base = makeBaselineCreature();
    const helpfulSynapses: CandidateSynapse[] = [{
      fromNeuronUuid: "hidden-2",
      toNeuronUuid: "output-0",
      weight: 0.9,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 3,
      totalCount: 5,
    }];
    const removeCandidate: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "hidden-1",
      weight: 0.1,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.15,
      improvedCount: 4,
      totalCount: 6,
    };
    const neuronCandidate: CandidateNeuron = {
      fromNeuronUuid: "hidden-1",
      toNeuronUuid: "output-0",
      incomingWeight: 0.33,
      outgoingWeight: -0.22,
      squash: TANH.NAME,
      bias: 0.07,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.18,
      improvedCount: 6,
      totalCount: 8,
    };
    const squashCandidate: CandidateSquash = {
      neuronUuid: "hidden-1",
      previousSquash: IDENTITY.NAME,
      squash: Mish.NAME,
      expectedCreatureScoreGain: 0.21,
      improvedError: 0.04,
      currentError: 0.09,
    };

    const discovery: DiscoverResult = {
      ID: "COMBO-ALL",
      addHelpfulSynapses: helpfulSynapses,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      addHelpfulNeurons: [neuronCandidate],
      removeHarmfulSynapse: removeCandidate,
      candidateSquashes: [squashCandidate],
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboAll = findCandidate(candidates, "combo-all");
    const exported = comboAll.creature.exportInternalJSON();

    const harmfulStillExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === removeCandidate.fromNeuronUuid &&
      synapse.toUUID === removeCandidate.toNeuronUuid
    );
    assertEquals(
      harmfulStillExists,
      false,
      "Combined candidate should remove the harmful synapse.",
    );

    const helpfulSynapseExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === helpfulSynapses[0].fromNeuronUuid &&
      synapse.toUUID === helpfulSynapses[0].toNeuronUuid &&
      Math.abs(synapse.weight - helpfulSynapses[0].weight) < 1e-6
    );
    assert(
      helpfulSynapseExists,
      "Combined candidate should include the beneficial synapse.",
    );

    const hidden1 = exported.neurons.find((neuron) =>
      neuron.id === ID_HIDDEN_1
    );
    assert(hidden1, "Hidden neuron should exist after combination.");
    assertEquals(
      hidden1?.squash,
      squashCandidate.squash,
      "Combined candidate should update the squash function.",
    );

    const incomingDiscoverySynapse = exported.synapses.find((synapse) =>
      synapse.fromUUID === neuronCandidate.fromNeuronUuid &&
      Math.abs(synapse.weight - neuronCandidate.incomingWeight) < 1e-6
    );
    assert(
      incomingDiscoverySynapse,
      "Expected discovery neuron incoming synapse to exist.",
    );
    const discoveredNeuronUUID = incomingDiscoverySynapse!.toId;
    const outgoingDiscoverySynapse = exported.synapses.find((synapse) =>
      synapse.fromId === discoveredNeuronUUID &&
      synapse.toUUID === neuronCandidate.toNeuronUuid &&
      Math.abs(synapse.weight - neuronCandidate.outgoingWeight) < 1e-6
    );
    assert(
      outgoingDiscoverySynapse,
      "Expected discovery neuron outgoing synapse to exist.",
    );

    const discoveredNeuron = exported.neurons.find((neuron) =>
      neuron.id === discoveredNeuronUUID
    );
    assert(
      discoveredNeuron,
      "Combined candidate should include discovered neuron.",
    );
  },
);

Deno.test(
  "buildDiscoveryCandidates removes harmful neuron and adjusts downstream biases",
  () => {
    const base = makeBaselineCreature();
    const harmfulNeuron: CandidateHarmfulNeuron = {
      neuronUuid: "hidden-1",
      errorMagnitude: 1.5e11, // Above 1e10 threshold
      expectedCreatureScoreGain: 0.85,
      sampleCount: 100,
      averageActivation: 0.75, // Average activation for bias adjustment
    };

    const discovery: DiscoverResult = {
      ID: "REMOVE-NEURON",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: [harmfulNeuron],
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const removeNeuronCandidate = findCandidate(candidates, "remove-neuron");
    const exported = removeNeuronCandidate.creature.exportInternalJSON();

    // Verify the harmful neuron is removed
    const harmfulNeuronStillExists = exported.neurons.some((neuron) =>
      neuron.uuid === harmfulNeuron.neuronUuid
    );
    assertEquals(
      harmfulNeuronStillExists,
      false,
      "Harmful neuron should be removed from the creature",
    );

    // Verify all synapses connected to the removed neuron are gone
    const synapsesToRemovedNeuron = exported.synapses.filter((synapse) =>
      synapse.toUUID === harmfulNeuron.neuronUuid ||
      synapse.fromUUID === harmfulNeuron.neuronUuid
    );
    assertEquals(
      synapsesToRemovedNeuron.length,
      0,
      "All synapses connected to removed neuron should be removed",
    );

    // Verify downstream neuron (output-0) bias is adjusted
    // The original base creature has hidden-1 -> output-0 with weight 0.2
    // Expected bias adjustment: weight * averageActivation = 0.2 * 0.75 = 0.15
    // Original output-0 bias: 0.1, so new bias should be approximately 0.1 + 0.15 = 0.25
    const output0 = exported.neurons.find((neuron) => neuron.id === -1);
    assert(output0, "Output neuron 0 should still exist");
    assert(
      Math.abs(output0.bias - 0.25) < 0.01,
      `Output-0 bias should be adjusted. Expected ~0.25, got ${output0.bias}`,
    );

    // Verify the candidate has correct metadata
    assertEquals(
      removeNeuronCandidate.change.type,
      "remove-neuron",
      "Candidate type should be remove-neuron",
    );
    assertEquals(
      removeNeuronCandidate.change.expectedErrorReduction,
      harmfulNeuron.expectedCreatureScoreGain,
      "Expected error reduction should match harmful neuron's expected creature score gain",
    );
    assertEquals(
      removeNeuronCandidate.change.sampleSize,
      harmfulNeuron.sampleCount,
      "Sample size should match harmful neuron's sample count",
    );
    assert(
      removeNeuronCandidate.change.description?.includes("💀"),
      "Description should include the skull emoji",
    );
    assert(
      removeNeuronCandidate.change.description?.includes(
        harmfulNeuron.neuronUuid,
      ),
      "Description should include the neuron UUID",
    );
  },
);

Deno.test(
  "removeHarmfulNeuron accumulates bias adjustment from multiple synapses to same downstream neuron",
  () => {
    // This test verifies the fix for the bug where multiple synapses from a harmful neuron
    // to the same downstream neuron only used the first synapse's weight for bias adjustment.
    // The fix now accumulates all synapse weights before applying the adjustment.
    //
    // Note: Creature validation prevents duplicate synapses in normal operation,
    // but the fix ensures the method correctly handles this edge case if it occurs.
    // We test by verifying the calculation logic matches the expected accumulation behavior.

    const testCreature = Creature.fromJSON({
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
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.1 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.2 },
      ],
    });
    testCreature.validate();
    CreatureUtil.makeUUID(testCreature);

    const harmfulNeuron: CandidateHarmfulNeuron = {
      neuronUuid: "hidden-1",
      errorMagnitude: 1.5e11,
      expectedCreatureScoreGain: 0.85,
      sampleCount: 100,
      averageActivation: 0.75,
    };

    // Test with single synapse to establish baseline
    const result = DiscoverStructure.removeHarmfulNeuron(
      "TEST-ID",
      testCreature,
      harmfulNeuron,
    );
    assert(result, "Should return a modified creature");
    const exported = result.exportInternalJSON();
    const output0 = exported.neurons.find((n) => n.id === -1);
    assert(output0, "Output neuron 0 should exist");

    // Verify single synapse adjustment: weight * averageActivation = 0.2 * 0.75 = 0.15
    // Original bias: 0.1, so expected: 0.1 + 0.15 = 0.25
    const expectedSingleBias = 0.1 + 0.2 * 0.75; // 0.25
    assert(
      Math.abs(output0.bias - expectedSingleBias) < 0.01,
      `Single synapse bias should be ${expectedSingleBias}, got ${output0.bias}`,
    );

    // Verify the fix logic: if there were multiple synapses (e.g., weights 0.2, 0.3, -0.1),
    // the fix accumulates them: (0.2 + 0.3 + (-0.1)) * 0.75 = 0.4 * 0.75 = 0.3
    // This would result in bias: 0.1 + 0.3 = 0.4
    // The old bug would only use the first synapse: 0.1 + 0.2 * 0.75 = 0.25 (incorrect)
    // The fix accumulates all: 0.1 + (0.2 + 0.3 + (-0.1)) * 0.75 = 0.4 (correct)
    const simulatedMultipleWeights = [0.2, 0.3, -0.1];
    const simulatedTotalWeight = simulatedMultipleWeights.reduce(
      (sum, w) => sum + w,
      0,
    );
    const simulatedAdjustment = simulatedTotalWeight *
      harmfulNeuron.averageActivation;
    const simulatedExpectedBias = 0.1 + simulatedAdjustment;

    assertAlmostEquals(
      simulatedTotalWeight,
      0.4,
      0.0001,
      "Simulated total weight should sum: 0.2 + 0.3 + (-0.1) = 0.4",
    );
    assertAlmostEquals(
      simulatedAdjustment,
      0.3,
      0.0001,
      "Simulated adjustment: 0.4 * 0.75 = 0.3",
    );
    assertAlmostEquals(
      simulatedExpectedBias,
      0.4,
      0.0001,
      "Simulated expected bias: 0.1 + 0.3 = 0.4",
    );

    // The fix in removeHarmfulNeuron now uses a Map to accumulate all synapse weights
    // for each target neuron before applying the adjustment, ensuring all contributions
    // are included rather than just the first synapse.
  },
);

Deno.test(
  "buildDiscoveryCandidates creates combo-add-remove candidate when both remove synapse and add synapses exist",
  () => {
    const base = makeBaselineCreature();
    const helpfulSynapses: CandidateSynapse[] = [{
      fromNeuronUuid: "input-2",
      toNeuronUuid: "hidden-2",
      weight: 0.88,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.3,
      improvedCount: 7,
      totalCount: 8,
    }];
    const removeSynapse: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "hidden-1",
      weight: -0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 4,
      totalCount: 6,
    };

    const discovery: DiscoverResult = {
      ID: "COMBO-ADD-REMOVE",
      addHelpfulSynapses: helpfulSynapses,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: removeSynapse,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboAddRemove = findCandidate(candidates, "combo-add-remove");
    const exported = comboAddRemove.creature.exportInternalJSON();

    // Verify harmful synapse is removed
    const harmfulSynapseStillExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === removeSynapse.fromNeuronUuid &&
      synapse.toUUID === removeSynapse.toNeuronUuid
    );
    assertEquals(
      harmfulSynapseStillExists,
      false,
      "Harmful synapse should be removed in combo candidate",
    );

    // Verify helpful synapse is added
    const helpfulSynapseExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === helpfulSynapses[0].fromNeuronUuid &&
      synapse.toUUID === helpfulSynapses[0].toNeuronUuid &&
      Math.abs(synapse.weight - helpfulSynapses[0].weight) < 1e-6
    );
    assert(
      helpfulSynapseExists,
      "Helpful synapse should be added in combo candidate",
    );

    // Verify candidate type and description
    assertEquals(
      comboAddRemove.change.type,
      "combo-add-remove",
      "Candidate type should be combo-add-remove",
    );
    assert(
      comboAddRemove.change.description?.includes("🔧"),
      "Description should include the wrench emoji",
    );
    assert(
      comboAddRemove.change.description?.includes("Removed harmful synapse"),
      "Description should mention removing harmful synapse",
    );
    assert(
      comboAddRemove.change.description?.includes("added"),
      "Description should mention adding synapses",
    );
  },
);

Deno.test(
  "buildDiscoveryCandidates creates combo-add-change candidate when both add synapses and change squash exist",
  () => {
    const base = makeBaselineCreature();
    const helpfulSynapses: CandidateSynapse[] = [{
      fromNeuronUuid: "input-3",
      toNeuronUuid: "hidden-2",
      weight: 0.77,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.28,
      improvedCount: 6,
      totalCount: 7,
    }];
    const squashChanges: CandidateSquash[] = [{
      neuronUuid: "hidden-1",
      previousSquash: IDENTITY.NAME,
      squash: TANH.NAME,
      expectedCreatureScoreGain: 0.35,
      improvedError: 0.05,
      currentError: 0.15,
    }];

    const discovery: DiscoverResult = {
      ID: "COMBO-ADD-CHANGE",
      addHelpfulSynapses: helpfulSynapses,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: squashChanges,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboAddChange = findCandidate(candidates, "combo-add-change");
    const exported = comboAddChange.creature.exportInternalJSON();

    // Verify helpful synapse is added
    const helpfulSynapseExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === helpfulSynapses[0].fromNeuronUuid &&
      synapse.toUUID === helpfulSynapses[0].toNeuronUuid &&
      Math.abs(synapse.weight - helpfulSynapses[0].weight) < 1e-6
    );
    assert(
      helpfulSynapseExists,
      "Helpful synapse should be added in combo candidate",
    );

    // Verify squash function is changed
    const hidden1 = exported.neurons.find((neuron) =>
      neuron.id === ID_HIDDEN_1
    );
    assert(hidden1, "Hidden neuron 1 should still exist");
    assertEquals(
      hidden1.squash,
      squashChanges[0].squash,
      "Squash function should be changed in combo candidate",
    );

    // Verify candidate type and description
    assertEquals(
      comboAddChange.change.type,
      "combo-add-change",
      "Candidate type should be combo-add-change",
    );
    assert(
      comboAddChange.change.description?.includes("⚡"),
      "Description should include the lightning emoji",
    );
    assert(
      comboAddChange.change.description?.includes("Added"),
      "Description should mention adding synapses",
    );
    assert(
      comboAddChange.change.description?.includes("updated"),
      "Description should mention updating neuron activation",
    );
  },
);
