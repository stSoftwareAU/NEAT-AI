import { assert, assertEquals } from "@std/assert";
import { getTag, type TagsInterface } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryCandidate,
  pruneSuccessfulCandidatesForCombos,
} from "../../src/discovery/DiscoveryCandidates.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

// Integer IDs for neurons in makeBaselineCreature (deterministicIdFromUuid).
// Input neurons: id = inputIndex (0..3), output neurons: id = -(index+1) (-1, -2).
const HIDDEN_1_ID = 1775329650; // "hidden-1"
const HIDDEN_2_ID = 1775329649; // "hidden-2"
const OUTPUT_0_ID = -1; // "output-0"
const OUTPUT_1_ID = -2; // "output-1"

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

function findCandidate(
  candidates: DiscoveryCandidate[],
  type: DiscoveryCandidate["change"]["type"],
): DiscoveryCandidate {
  const candidate = candidates.find((entry) => entry.change.type === type);
  assert(candidate, `Expected to find candidate for ${type}`);
  return candidate;
}

function findCandidates(
  candidates: DiscoveryCandidate[],
  type: DiscoveryCandidate["change"]["type"],
): DiscoveryCandidate[] {
  return candidates.filter((entry) => entry.change.type === type);
}

Deno.test("buildDiscoveryCandidates returns empty list when there are no suggestions", () => {
  const base = makeBaselineCreature();
  const discovery: DiscoverResult = {
    ID: "ABCD1234",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates: DiscoveryCandidate[] = buildDiscoveryCandidates(
    base,
    discovery,
  );
  assertEquals(candidates.length, 0);
  const originalSynapseCount = base.exportJSON().synapses.length;
  assertEquals(originalSynapseCount, 5);
});

Deno.test(
  "buildDiscoveryCandidates emits individual candidates for each helpful synapse",
  () => {
    const base = makeBaselineCreature();
    const synapses: CandidateSynapse[] = [{
      fromNeuronId: 2,
      toNeuronId: HIDDEN_1_ID,
      weight: 0.99,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.25,
      improvedCount: 5,
      totalCount: 6,
      comment: "rust: diagnostic comment for first synapse",
    }, {
      fromNeuronId: 3,
      toNeuronId: HIDDEN_2_ID,
      weight: -0.55,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.3,
      improvedCount: 6,
      totalCount: 7,
      comment: "rust: diagnostic comment for second synapse",
    }];
    const discovery: DiscoverResult = {
      ID: "SYN-MULTI",
      addHelpfulSynapses: synapses,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const addSynapseCandidates = findCandidates(candidates, "add-synapses");

    const findDedicatedCandidate = (target: CandidateSynapse) => {
      return addSynapseCandidates.find((candidate) => {
        const exported = candidate.creature.exportJSON();
        const hasTarget = exported.synapses.some((synapse) =>
          synapse.fromId === target.fromNeuronId &&
          synapse.toId === target.toNeuronId &&
          Math.abs(synapse.weight - target.weight) < 1e-9
        );
        if (!hasTarget) return false;
        const hasOtherNew = synapses.some((other) => {
          if (other === target) return false;
          return exported.synapses.some((synapse) =>
            synapse.fromId === other.fromNeuronId &&
            synapse.toId === other.toNeuronId &&
            Math.abs(synapse.weight - other.weight) < 1e-9
          );
        });
        return !hasOtherNew;
      });
    };

    const first = findDedicatedCandidate(synapses[0]);
    assert(first, "Expected candidate dedicated to first helpful synapse");
    const firstExport = first.creature.exportJSON();
    const firstSynapse = firstExport.synapses.find((synapse) =>
      synapse.fromId === synapses[0].fromNeuronId &&
      synapse.toId === synapses[0].toNeuronId &&
      Math.abs(synapse.weight - synapses[0].weight) < 1e-9
    );
    assert(firstSynapse, "Expected first candidate to contain target synapse");
    assertEquals(
      getTag(firstSynapse as unknown as TagsInterface, "discovery-comment"),
      synapses[0].comment,
    );

    const second = findDedicatedCandidate(synapses[1]);
    assert(second, "Expected candidate dedicated to second helpful synapse");
    const secondExport = second.creature.exportJSON();
    const secondSynapse = secondExport.synapses.find((synapse) =>
      synapse.fromId === synapses[1].fromNeuronId &&
      synapse.toId === synapses[1].toNeuronId &&
      Math.abs(synapse.weight - synapses[1].weight) < 1e-9
    );
    assert(
      secondSynapse,
      "Expected second candidate to contain target synapse",
    );
    assertEquals(
      getTag(secondSynapse as unknown as TagsInterface, "discovery-comment"),
      synapses[1].comment,
    );
  },
);

Deno.test(
  "buildDiscoveryCandidates emits individual candidates for each squash change",
  () => {
    const base = makeBaselineCreature();
    const squashes: CandidateSquash[] = [{
      neuronId: HIDDEN_1_ID,
      previousSquash: IDENTITY.NAME,
      squash: TANH.NAME,
      expectedCreatureScoreGain: 0.4,
      improvedError: 0.1,
      currentError: 0.2,
    }, {
      neuronId: HIDDEN_2_ID,
      previousSquash: IDENTITY.NAME,
      squash: Mish.NAME,
      expectedCreatureScoreGain: 0.3,
      improvedError: 0.2,
      currentError: 0.4,
    }];
    const discovery: DiscoverResult = {
      ID: "SQUASH-MULTI",
      addHelpfulSynapses: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      candidateSquashes: squashes,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const squashCandidates = findCandidates(candidates, "change-squash");
    assert(
      squashCandidates.length >= squashes.length,
      "Expected at least one candidate per squash suggestion",
    );

    for (const suggestion of squashes) {
      const dedicated = squashCandidates.find((candidate) => {
        const exported = candidate.creature.exportJSON();
        const targetNeuron = exported.neurons.find((neuron) =>
          neuron.id === suggestion.neuronId
        );
        if (!targetNeuron) return false;
        const hasDesiredSquash = targetNeuron.squash === suggestion.squash;
        const otherSuggestion = squashes.find((entry) =>
          entry.neuronId !== suggestion.neuronId
        );
        const otherNeuron = otherSuggestion
          ? exported.neurons.find((neuron) =>
            neuron.id === otherSuggestion.neuronId
          )
          : undefined;
        const otherChanged = otherNeuron
          ? otherNeuron.squash === otherSuggestion?.squash
          : false;
        return hasDesiredSquash && !otherChanged;
      });
      assert(
        dedicated,
        `Expected dedicated candidate for squash on ${suggestion.neuronId}`,
      );
    }
  },
);

Deno.test(
  "buildDiscoveryCandidates combines best candidate from each category",
  () => {
    const base = makeBaselineCreature();
    const synapses: CandidateSynapse[] = [{
      fromNeuronId: 2,
      toNeuronId: HIDDEN_1_ID,
      weight: 0.91,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.05,
      improvedCount: 3,
      totalCount: 4,
    }, {
      fromNeuronId: 3,
      toNeuronId: HIDDEN_2_ID,
      weight: -0.33,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.35,
      improvedCount: 6,
      totalCount: 7,
    }];
    const neurons: CandidateNeuron[] = [{
      fromNeuronId: HIDDEN_1_ID,
      toNeuronId: OUTPUT_0_ID,
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
      fromNeuronId: HIDDEN_2_ID,
      toNeuronId: OUTPUT_1_ID,
      incomingWeight: -0.38,
      outgoingWeight: 0.22,
      squash: Mish.NAME,
      bias: -0.05,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.45,
      improvedCount: 7,
      totalCount: 8,
    }];
    const squashes: CandidateSquash[] = [{
      neuronId: HIDDEN_1_ID,
      previousSquash: IDENTITY.NAME,
      squash: Mish.NAME,
      expectedCreatureScoreGain: 0.05,
      improvedError: 0.2,
      currentError: 0.6,
    }, {
      neuronId: HIDDEN_2_ID,
      previousSquash: IDENTITY.NAME,
      squash: TANH.NAME,
      expectedCreatureScoreGain: 0.34,
      improvedError: 0.1,
      currentError: 0.4,
    }];
    const removeCandidate: CandidateSynapse = {
      fromNeuronId: 0,
      toNeuronId: HIDDEN_1_ID,
      weight: -0.99,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 3,
      totalCount: 5,
    };

    const discovery: DiscoverResult = {
      ID: "BEST-COMBO",
      addHelpfulSynapses: synapses,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      addHelpfulNeurons: neurons,
      removeHarmfulSynapse: removeCandidate,
      candidateSquashes: squashes,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboBest = findCandidate(candidates, "combo-best-of-category");
    const exported = comboBest.creature.exportJSON();

    const hasBestSynapse = exported.synapses.some((synapse) =>
      synapse.fromId === synapses[1].fromNeuronId &&
      synapse.toId === synapses[1].toNeuronId
    );
    assert(
      hasBestSynapse,
      "Best-of-category combo should include the top synapse candidate",
    );

    // The newly injected discovery neuron has the "discovered" tag set by
    // addHelpfulNeurons and an ID that is NOT in the base creature (squash-changed
    // existing neurons also receive the "discovered" tag, so we must distinguish
    // the injected neuron by its absence from the base creature).
    const baseNeuronIds = new Set(base.neurons.map((n) => n.id));
    const discoveryNeuron = exported.neurons.find((neuron) =>
      getTag(neuron as unknown as TagsInterface, "discovered") !== null &&
      neuron.id !== undefined &&
      !baseNeuronIds.has(neuron.id)
    );
    assert(discoveryNeuron, "Expected discovery neuron to be present.");
    assertEquals(
      discoveryNeuron?.squash,
      neurons[1].squash,
      "Best discovery neuron should dictate squash for injected neuron.",
    );

    const hidden2 = exported.neurons.find((neuron) =>
      neuron.id === HIDDEN_2_ID
    );
    assert(hidden2, "Hidden neuron 2 should exist.");
    assertEquals(
      hidden2?.squash,
      squashes[1].squash,
      "Best-of-category combo should update squash with highest expected gain.",
    );

    const harmfulStillExists = exported.synapses.some((synapse) =>
      synapse.fromId === removeCandidate.fromNeuronId &&
      synapse.toId === removeCandidate.toNeuronId
    );
    assertEquals(
      harmfulStillExists,
      false,
      "Best-of-category combo should remove the harmful synapse.",
    );
  },
);

Deno.test(
  "buildDiscoveryCandidates includes removeHarmfulNeurons in best-of-category candidate",
  () => {
    const base = makeBaselineCreature();
    const harmfulNeurons: CandidateHarmfulNeuron[] = [{
      neuronId: HIDDEN_1_ID,
      errorMagnitude: 1.5e11, // Above 1e10 threshold
      expectedCreatureScoreGain: 0.85,
      sampleCount: 100,
      averageActivation: 0.75,
    }, {
      neuronId: HIDDEN_2_ID,
      errorMagnitude: 1.2e11, // Second most harmful
      expectedCreatureScoreGain: 0.80,
      sampleCount: 90,
      averageActivation: 0.70,
    }];
    const synapses: CandidateSynapse[] = [{
      fromNeuronId: 1,
      toNeuronId: HIDDEN_2_ID,
      weight: 0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 4,
      totalCount: 5,
    }, {
      fromNeuronId: 2,
      toNeuronId: HIDDEN_2_ID,
      weight: 0.6,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.3,
      improvedCount: 5,
      totalCount: 6,
    }];

    const discovery: DiscoverResult = {
      ID: "BEST-WITH-REMOVE-NEURON",
      addHelpfulSynapses: synapses,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: harmfulNeurons,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboBest = findCandidate(candidates, "combo-best-of-category");
    const exported = comboBest.creature.exportJSON();

    // Verify the most harmful neuron (first in sorted array) is removed
    const harmfulNeuronStillExists = exported.neurons.some((neuron) =>
      neuron.id === harmfulNeurons[0].neuronId
    );
    assertEquals(
      harmfulNeuronStillExists,
      false,
      "Best-of-category combo should remove the most harmful neuron",
    );

    // Verify the best synapse is included
    const hasBestSynapse = exported.synapses.some((synapse) =>
      synapse.fromId === synapses[1].fromNeuronId &&
      synapse.toId === synapses[1].toNeuronId
    );
    assert(
      hasBestSynapse,
      "Best-of-category combo should include the top synapse candidate",
    );
  },
);

Deno.test("buildDiscoveryCandidates includes helpful neuron suggestions", () => {
  const base = makeBaselineCreature();
  const neuronCandidate: CandidateNeuron = {
    fromNeuronId: HIDDEN_1_ID,
    toNeuronId: OUTPUT_0_ID,
    incomingWeight: 0.42,
    outgoingWeight: -0.27,
    squash: TANH.NAME,
    bias: 0.11,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: 0.25,
    improvedCount: 8,
    totalCount: 10,
    comment: "rust: diagnostic comment for added neuron",
  };

  const discovery: DiscoverResult = {
    ID: "NEURON-123",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: [neuronCandidate],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(base, discovery);
  const addedNeuron = findCandidate(candidates, "add-neurons");
  const exported = addedNeuron.creature.exportJSON();

  // Discovered neurons have the "discovered" tag set by addHelpfulNeurons.
  const discoveryNeuron = exported.neurons.find((neuron) =>
    getTag(neuron as unknown as TagsInterface, "discovered") !== null
  );
  assert(discoveryNeuron, "Expected a discovered neuron to be added.");
  assertEquals(discoveryNeuron?.squash, neuronCandidate.squash);
  assertEquals(
    getTag(discoveryNeuron as unknown as TagsInterface, "discovery-comment"),
    neuronCandidate.comment,
  );

  const incomingSynapseExists = exported.synapses.some((synapse) =>
    synapse.toId === discoveryNeuron?.id &&
    synapse.fromId === neuronCandidate.fromNeuronId
  );
  const outgoingSynapseExists = exported.synapses.some((synapse) =>
    synapse.fromId === discoveryNeuron?.id &&
    synapse.toId === neuronCandidate.toNeuronId
  );

  assert(
    incomingSynapseExists && outgoingSynapseExists,
    "Expected discovered neuron to include incoming and outgoing synapses.",
  );
});

Deno.test(
  "pruneSuccessfulCandidatesForCombos keeps best add-neurons per from→to slot",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "PRUNE-ADD-NEURONS",
      addHelpfulSynapses: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      removeHarmfulSynapse: undefined,
      candidateSquashes: undefined,
      addHelpfulNeurons: [
        // Same from→to slot (HIDDEN_1_ID → OUTPUT_0_ID), two variants.
        {
          fromNeuronId: HIDDEN_1_ID,
          toNeuronId: OUTPUT_0_ID,
          incomingWeight: 0.42,
          outgoingWeight: -0.27,
          squash: TANH.NAME,
          bias: 0.11,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.25,
          improvedCount: 8,
          totalCount: 10,
        },
        {
          fromNeuronId: HIDDEN_1_ID,
          toNeuronId: OUTPUT_0_ID,
          incomingWeight: 4.2,
          outgoingWeight: -2.7,
          squash: Mish.NAME,
          bias: 1.1,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.24,
          improvedCount: 8,
          totalCount: 10,
        },
        // Different slot (HIDDEN_2_ID → OUTPUT_1_ID).
        {
          fromNeuronId: HIDDEN_2_ID,
          toNeuronId: OUTPUT_1_ID,
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
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    // buildDiscoveryCandidates may also emit a combined add-neurons candidate; for this
    // test we only care about the dedicated single-step add-neuron candidates (which
    // include neuronDetails).
    const addNeuronCandidates = candidates.filter((c) =>
      c.change.type === "add-neurons" && c.change.neuronDetails !== undefined
    );
    assertEquals(
      addNeuronCandidates.length,
      3,
      "Precondition: expected 3 add-neurons candidates",
    );

    const slotA = addNeuronCandidates.filter((c) =>
      c.change.neuronDetails?.fromNeuronId === HIDDEN_1_ID &&
      c.change.neuronDetails?.toNeuronId === OUTPUT_0_ID
    );
    assertEquals(
      slotA.length,
      2,
      "Precondition: expected 2 candidates for same slot",
    );

    // Give the second slotA candidate the larger measured gain.
    const pruned = pruneSuccessfulCandidatesForCombos([
      { candidate: slotA[0], scoreDelta: 0.001 },
      { candidate: slotA[1], scoreDelta: 0.002 },
      {
        candidate: addNeuronCandidates.find((c) =>
          c.change.neuronDetails?.fromNeuronId === HIDDEN_2_ID &&
          c.change.neuronDetails?.toNeuronId === OUTPUT_1_ID
        )!,
        scoreDelta: 0.0005,
      },
    ]);

    assertEquals(
      pruned.length,
      2,
      "Should keep best candidate per from→to slot",
    );
    const keptSlotA = pruned.find((c) =>
      c.change.type === "add-neurons" &&
      c.change.neuronDetails?.fromNeuronId === HIDDEN_1_ID &&
      c.change.neuronDetails?.toNeuronId === OUTPUT_0_ID
    );
    assert(keptSlotA, "Expected the hidden-1→output-0 slot to be kept");
    assertEquals(
      keptSlotA.change.neuronDetails?.squash,
      slotA[1].change.neuronDetails?.squash,
      "Should keep the best-scoring variant for the slot",
    );
  },
);
