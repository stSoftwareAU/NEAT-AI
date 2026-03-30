import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  buildDiscoveryCandidates,
  pruneSuccessfulCandidatesForCombos,
} from "../../src/discovery/DiscoveryCandidates.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { Mish } from "@methods/activations/types/Mish.ts";
import { TANH } from "@methods/activations/types/TANH.ts";

function makeBaselineCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 4,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: "IDENTITY", bias: 0.5 },
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

Deno.test(
  "buildDiscoveryCandidates (skipCombinedCandidates) emits only single-step candidates for add-neurons/add-synapses/change-squash",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "PHASE1-SINGLES-ONLY",
      addHelpfulSynapses: [{
        fromNeuronUuid: "input-2",
        toNeuronUuid: "hidden-1",
        weight: 0.99,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.25,
        improvedCount: 5,
        totalCount: 6,
      }, {
        fromNeuronUuid: "input-3",
        toNeuronUuid: "hidden-2",
        weight: -0.55,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.3,
        improvedCount: 6,
        totalCount: 7,
      }],
      addHelpfulNeurons: [{
        fromNeuronUuid: "hidden-1",
        toNeuronUuid: "output-0",
        incomingWeight: 0.45,
        outgoingWeight: -0.12,
        squash: TANH.NAME,
        bias: 0.1,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.1,
        improvedCount: 5,
        totalCount: 6,
      }, {
        fromNeuronUuid: "hidden-2",
        toNeuronUuid: "output-1",
        incomingWeight: -0.38,
        outgoingWeight: 0.22,
        squash: Mish.NAME,
        bias: -0.05,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.45,
        improvedCount: 7,
        totalCount: 8,
      }],
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [{
        neuronUuid: "hidden-1",
        previousSquash: IDENTITY.NAME,
        squash: TANH.NAME,
        expectedCreatureScoreGain: 0.4,
        improvedError: 0.1,
        currentError: 0.2,
      }, {
        neuronUuid: "hidden-2",
        previousSquash: IDENTITY.NAME,
        squash: Mish.NAME,
        expectedCreatureScoreGain: 0.3,
        improvedError: 0.2,
        currentError: 0.4,
      }],
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    // Phase-1 requirement: only dedicated single-step candidates should exist for these types.
    const addNeuronCandidates = candidates.filter((c) =>
      c.change.type === "add-neurons"
    );
    assertEquals(
      addNeuronCandidates.length,
      discovery.addHelpfulNeurons!.length,
      "Expected exactly one add-neurons candidate per suggestion when skipCombinedCandidates is true",
    );
    assertEquals(
      addNeuronCandidates.every((c) => c.change.neuronDetails !== undefined),
      true,
      "Expected add-neurons candidates to carry neuronDetails (single-step)",
    );

    const addSynapseCandidates = candidates.filter((c) =>
      c.change.type === "add-synapses"
    );
    assertEquals(
      addSynapseCandidates.length,
      discovery.addHelpfulSynapses!.length,
      "Expected exactly one add-synapses candidate per suggestion when skipCombinedCandidates is true",
    );
    assertEquals(
      addSynapseCandidates.every((c) =>
        c.change.synapseCandidate !== undefined
      ),
      true,
      "Expected add-synapses candidates to carry synapseCandidate (single-step)",
    );

    const squashCandidates = candidates.filter((c) =>
      c.change.type === "change-squash"
    );
    assertEquals(
      squashCandidates.length,
      discovery.candidateSquashes!.length,
      "Expected exactly one change-squash candidate per suggestion when skipCombinedCandidates is true",
    );
    assertEquals(
      squashCandidates.every((c) => c.change.squashCandidate !== undefined),
      true,
      "Expected change-squash candidates to carry squashCandidate (single-step)",
    );

    // Defensive: no combo-* should ever appear when skipCombinedCandidates is true.
    assertEquals(
      candidates.some((c) => c.change.type.startsWith("combo-")),
      false,
      "Expected no combo-* candidates when skipCombinedCandidates is true",
    );
  },
);

Deno.test(
  "pruneSuccessfulCandidatesForCombos keeps best add-synapses per from→to slot",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "PRUNE-ADD-SYNAPSES",
      addHelpfulSynapses: [
        // Same from→to slot, two variants with different weights.
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 5,
          totalCount: 6,
        },
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.9,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.25,
          improvedCount: 6,
          totalCount: 7,
        },
        // Different slot.
        {
          fromNeuronUuid: "input-3",
          toNeuronUuid: "hidden-2",
          weight: -0.4,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.15,
          improvedCount: 4,
          totalCount: 5,
        },
      ],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });
    const addSynapseCandidates = candidates.filter((c) =>
      c.change.type === "add-synapses" &&
      c.change.synapseCandidate !== undefined
    );
    assertEquals(
      addSynapseCandidates.length,
      3,
      "Precondition: expected 3 add-synapses candidates",
    );

    const slotA = addSynapseCandidates.filter((c) =>
      c.change.synapseCandidate?.fromNeuronUuid === "input-2" &&
      c.change.synapseCandidate?.toNeuronUuid === "hidden-1"
    );
    assertEquals(
      slotA.length,
      2,
      "Precondition: expected 2 candidates for same slot",
    );

    // Give the second slotA candidate the larger measured gain.
    const pruned = pruneSuccessfulCandidatesForCombos([
      { candidate: slotA[0], scoreDelta: 0.001 },
      { candidate: slotA[1], scoreDelta: 0.003 },
      {
        candidate: addSynapseCandidates.find((c) =>
          c.change.synapseCandidate?.fromNeuronUuid === "input-3" &&
          c.change.synapseCandidate?.toNeuronUuid === "hidden-2"
        )!,
        scoreDelta: 0.002,
      },
    ]);

    assertEquals(
      pruned.length,
      2,
      "Should keep best candidate per from→to slot",
    );
    const keptSlotA = pruned.find((c) =>
      c.change.type === "add-synapses" &&
      c.change.synapseCandidate?.fromNeuronUuid === "input-2" &&
      c.change.synapseCandidate?.toNeuronUuid === "hidden-1"
    );
    assert(keptSlotA, "Expected the input-2→hidden-1 slot to be kept");
    assertEquals(
      keptSlotA.change.synapseCandidate?.weight,
      slotA[1].change.synapseCandidate?.weight,
      "Should keep the best-scoring variant for the slot (weight 0.9)",
    );
  },
);

Deno.test(
  "pruneSuccessfulCandidatesForCombos keeps best change-squash per neuron",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "PRUNE-CHANGE-SQUASH",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [
        // Same neuron, two different squash functions.
        {
          neuronUuid: "hidden-1",
          previousSquash: IDENTITY.NAME,
          squash: TANH.NAME,
          expectedCreatureScoreGain: 0.3,
          improvedError: 0.1,
          currentError: 0.2,
        },
        {
          neuronUuid: "hidden-1",
          previousSquash: IDENTITY.NAME,
          squash: Mish.NAME,
          expectedCreatureScoreGain: 0.35,
          improvedError: 0.08,
          currentError: 0.2,
        },
        // Different neuron.
        {
          neuronUuid: "hidden-2",
          previousSquash: IDENTITY.NAME,
          squash: TANH.NAME,
          expectedCreatureScoreGain: 0.2,
          improvedError: 0.15,
          currentError: 0.3,
        },
      ],
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });
    const squashCandidates = candidates.filter((c) =>
      c.change.type === "change-squash" &&
      c.change.squashCandidate !== undefined
    );
    assertEquals(
      squashCandidates.length,
      3,
      "Precondition: expected 3 change-squash candidates",
    );

    const slotA = squashCandidates.filter((c) =>
      c.change.squashCandidate?.neuronUuid === "hidden-1"
    );
    assertEquals(
      slotA.length,
      2,
      "Precondition: expected 2 candidates for same neuron",
    );

    // Give the second slotA candidate (Mish) the larger measured gain.
    const pruned = pruneSuccessfulCandidatesForCombos([
      { candidate: slotA[0], scoreDelta: 0.001 },
      { candidate: slotA[1], scoreDelta: 0.004 },
      {
        candidate: squashCandidates.find((c) =>
          c.change.squashCandidate?.neuronUuid === "hidden-2"
        )!,
        scoreDelta: 0.002,
      },
    ]);

    assertEquals(
      pruned.length,
      2,
      "Should keep best candidate per neuron slot",
    );
    const keptSlotA = pruned.find((c) =>
      c.change.type === "change-squash" &&
      c.change.squashCandidate?.neuronUuid === "hidden-1"
    );
    assert(keptSlotA, "Expected the hidden-1 slot to be kept");
    assertEquals(
      keptSlotA.change.squashCandidate?.squash,
      Mish.NAME,
      "Should keep the best-scoring variant for the neuron (Mish)",
    );
  },
);

Deno.test(
  "pruneSuccessfulCandidatesForCombos sorts results by scoreDelta descending",
  () => {
    const base = makeBaselineCreature();

    // Create candidates that will have different scoreDelta values.
    const discovery: DiscoverResult = {
      ID: "PRUNE-SORT-TEST",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 5,
          totalCount: 6,
        },
        {
          fromNeuronUuid: "input-3",
          toNeuronUuid: "hidden-2",
          weight: -0.4,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.15,
          improvedCount: 4,
          totalCount: 5,
        },
      ],
      addHelpfulNeurons: [
        {
          fromNeuronUuid: "hidden-1",
          toNeuronUuid: "output-1",
          incomingWeight: 0.33,
          outgoingWeight: -0.22,
          squash: TANH.NAME,
          bias: 0.07,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.18,
          improvedCount: 6,
          totalCount: 8,
        },
      ],
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    // Assign different scoreDelta values to test sorting.
    const scoredCandidates = candidates.map((candidate, index) => ({
      candidate,
      // Assign: first = 0.001, second = 0.005, third = 0.002
      scoreDelta: index === 0 ? 0.001 : index === 1 ? 0.005 : 0.002,
    }));

    const pruned = pruneSuccessfulCandidatesForCombos(scoredCandidates);

    assertEquals(
      pruned.length,
      3,
      "Should keep all candidates (different slots)",
    );

    // The pruned candidates should be sorted by scoreDelta descending.
    // Find the scoreDelta for each pruned candidate by looking up in original.
    const prunedScoreDeltas = pruned.map((candidate) => {
      const scored = scoredCandidates.find((s) => s.candidate === candidate);
      return scored?.scoreDelta ?? 0;
    });

    // Verify sorted descending.
    for (let i = 1; i < prunedScoreDeltas.length; i++) {
      assert(
        prunedScoreDeltas[i - 1] >= prunedScoreDeltas[i],
        `Expected pruned candidates to be sorted by scoreDelta descending: ` +
          `${prunedScoreDeltas[i - 1]} should be >= ${prunedScoreDeltas[i]}`,
      );
    }

    assertEquals(
      prunedScoreDeltas[0],
      0.005,
      "First candidate should have highest scoreDelta",
    );
  },
);

Deno.test(
  "pruneSuccessfulCandidatesForCombos handles mixed candidate types correctly",
  () => {
    const base = makeBaselineCreature();

    // Create multiple candidate types.
    const discovery: DiscoverResult = {
      ID: "PRUNE-MIXED-TYPES",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 5,
          totalCount: 6,
        },
      ],
      addHelpfulNeurons: [
        {
          fromNeuronUuid: "hidden-1",
          toNeuronUuid: "output-0",
          incomingWeight: 0.45,
          outgoingWeight: -0.12,
          squash: TANH.NAME,
          bias: 0.1,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.1,
          improvedCount: 5,
          totalCount: 6,
        },
      ],
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [
        {
          neuronUuid: "hidden-1",
          previousSquash: IDENTITY.NAME,
          squash: TANH.NAME,
          expectedCreatureScoreGain: 0.3,
          improvedError: 0.1,
          currentError: 0.2,
        },
      ],
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    // All candidates have different slots (add-synapses: input-2→hidden-1,
    // add-neurons: hidden-1→output-0, change-squash: hidden-1).
    // Since add-synapses and add-neurons have different slot key prefixes,
    // they should both be kept.
    const scoredCandidates = candidates.map((candidate) => ({
      candidate,
      scoreDelta: 0.001, // Same score for all - none should be dropped.
    }));

    const pruned = pruneSuccessfulCandidatesForCombos(scoredCandidates);

    assertEquals(
      pruned.length,
      candidates.length,
      "All candidates should be kept when they have different slot keys",
    );

    // Verify each type is present.
    const types = pruned.map((c) => c.change.type);
    assert(types.includes("add-synapses"), "Should include add-synapses");
    assert(types.includes("add-neurons"), "Should include add-neurons");
    assert(types.includes("change-squash"), "Should include change-squash");
  },
);
