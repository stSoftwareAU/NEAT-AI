import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
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
      fromNeuronUUID: "input-2",
      toNeuronUUID: "hidden-1",
      weight: 0.99,
      expectedImprovementPercentage: 0.25,
      improvedCount: 5,
      totalCount: 6,
    }, {
      fromNeuronUUID: "input-3",
      toNeuronUUID: "hidden-2",
      weight: -0.55,
      expectedImprovementPercentage: 0.3,
      improvedCount: 6,
      totalCount: 7,
    }];
    const discovery: DiscoverResult = {
      ID: "SYN-MULTI",
      addHelpfulSynapses: synapses,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const addSynapseCandidates = findCandidates(candidates, "add-synapses");

    const findDedicatedCandidate = (target: CandidateSynapse) => {
      return addSynapseCandidates.find((candidate) => {
        const exported = candidate.creature.exportJSON();
        const hasTarget = exported.synapses.some((synapse) =>
          synapse.fromUUID === target.fromNeuronUUID &&
          synapse.toUUID === target.toNeuronUUID &&
          Math.abs(synapse.weight - target.weight) < 1e-9
        );
        if (!hasTarget) return false;
        const hasOtherNew = synapses.some((other) => {
          if (other === target) return false;
          return exported.synapses.some((synapse) =>
            synapse.fromUUID === other.fromNeuronUUID &&
            synapse.toUUID === other.toNeuronUUID &&
            Math.abs(synapse.weight - other.weight) < 1e-9
          );
        });
        return !hasOtherNew;
      });
    };

    assert(
      findDedicatedCandidate(synapses[0]),
      "Expected candidate dedicated to first helpful synapse",
    );
    assert(
      findDedicatedCandidate(synapses[1]),
      "Expected candidate dedicated to second helpful synapse",
    );
  },
);

Deno.test(
  "buildDiscoveryCandidates emits individual candidates for each squash change",
  () => {
    const base = makeBaselineCreature();
    const squashes: CandidateSquash[] = [{
      neuronUUID: "hidden-1",
      previousSquash: IDENTITY.NAME,
      squash: TANH.NAME,
      expectedImprovementPercentage: 0.4,
      improvedError: 0.1,
      currentError: 0.2,
    }, {
      neuronUUID: "hidden-2",
      previousSquash: IDENTITY.NAME,
      squash: Mish.NAME,
      expectedImprovementPercentage: 0.3,
      improvedError: 0.2,
      currentError: 0.4,
    }];
    const discovery: DiscoverResult = {
      ID: "SQUASH-MULTI",
      addHelpfulSynapses: undefined,
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
          neuron.uuid === suggestion.neuronUUID
        );
        if (!targetNeuron) return false;
        const hasDesiredSquash = targetNeuron.squash === suggestion.squash;
        const otherSuggestion = squashes.find((entry) =>
          entry.neuronUUID !== suggestion.neuronUUID
        );
        const otherNeuron = otherSuggestion
          ? exported.neurons.find((neuron) =>
            neuron.uuid === otherSuggestion.neuronUUID
          )
          : undefined;
        const otherChanged = otherNeuron
          ? otherNeuron.squash === otherSuggestion?.squash
          : false;
        return hasDesiredSquash && !otherChanged;
      });
      assert(
        dedicated,
        `Expected dedicated candidate for squash on ${suggestion.neuronUUID}`,
      );
    }
  },
);

Deno.test(
  "buildDiscoveryCandidates combines best candidate from each category",
  () => {
    const base = makeBaselineCreature();
    const synapses: CandidateSynapse[] = [{
      fromNeuronUUID: "input-2",
      toNeuronUUID: "hidden-1",
      weight: 0.91,
      expectedImprovementPercentage: 0.05,
      improvedCount: 3,
      totalCount: 4,
    }, {
      fromNeuronUUID: "input-3",
      toNeuronUUID: "hidden-2",
      weight: -0.33,
      expectedImprovementPercentage: 0.35,
      improvedCount: 6,
      totalCount: 7,
    }];
    const neurons: CandidateNeuron[] = [{
      fromNeuronUUID: "input-2",
      toNeuronUUID: "hidden-1",
      incomingWeight: 0.45,
      outgoingWeight: -0.12,
      squash: TANH.NAME,
      bias: 0.1,
      expectedImprovementPercentage: 0.1,
      improvedCount: 5,
      totalCount: 6,
    }, {
      fromNeuronUUID: "input-3",
      toNeuronUUID: "hidden-2",
      incomingWeight: -0.38,
      outgoingWeight: 0.22,
      squash: Mish.NAME,
      bias: -0.05,
      expectedImprovementPercentage: 0.45,
      improvedCount: 7,
      totalCount: 8,
    }];
    const squashes: CandidateSquash[] = [{
      neuronUUID: "hidden-1",
      previousSquash: IDENTITY.NAME,
      squash: Mish.NAME,
      expectedImprovementPercentage: 0.05,
      improvedError: 0.2,
      currentError: 0.6,
    }, {
      neuronUUID: "hidden-2",
      previousSquash: IDENTITY.NAME,
      squash: TANH.NAME,
      expectedImprovementPercentage: 0.34,
      improvedError: 0.1,
      currentError: 0.4,
    }];
    const removeCandidate: CandidateSynapse = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-1",
      weight: -0.99,
      expectedImprovementPercentage: 0.2,
      improvedCount: 3,
      totalCount: 5,
    };

    const discovery: DiscoverResult = {
      ID: "BEST-COMBO",
      addHelpfulSynapses: synapses,
      addHelpfulNeurons: neurons,
      removeHarmfulSynapse: removeCandidate,
      candidateSquashes: squashes,
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboBest = findCandidate(candidates, "combo-best-of-category");
    const exported = comboBest.creature.exportJSON();

    const hasBestSynapse = exported.synapses.some((synapse) =>
      synapse.fromUUID === synapses[1].fromNeuronUUID &&
      synapse.toUUID === synapses[1].toNeuronUUID
    );
    assert(
      hasBestSynapse,
      "Best-of-category combo should include the top synapse candidate",
    );

    const discoveryNeuron = exported.neurons.find((neuron) =>
      neuron.uuid.startsWith("hidden-discovery-")
    );
    assert(discoveryNeuron, "Expected discovery neuron to be present.");
    assertEquals(
      discoveryNeuron?.squash,
      neurons[1].squash,
      "Best discovery neuron should dictate squash for injected neuron.",
    );

    const hidden2 = exported.neurons.find((neuron) =>
      neuron.uuid === "hidden-2"
    );
    assert(hidden2, "Hidden neuron 2 should exist.");
    assertEquals(
      hidden2?.squash,
      squashes[1].squash,
      "Best-of-category combo should update squash with highest expected gain.",
    );

    const harmfulStillExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === removeCandidate.fromNeuronUUID &&
      synapse.toUUID === removeCandidate.toNeuronUUID
    );
    assertEquals(
      harmfulStillExists,
      false,
      "Best-of-category combo should remove the harmful synapse.",
    );
  },
);

Deno.test("buildDiscoveryCandidates includes helpful neuron suggestions", () => {
  const base = makeBaselineCreature();
  const neuronCandidate: CandidateNeuron = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "hidden-1",
    incomingWeight: 0.42,
    outgoingWeight: -0.27,
    squash: TANH.NAME,
    bias: 0.11,
    expectedImprovementPercentage: 0.25,
    improvedCount: 8,
    totalCount: 10,
  };

  const discovery: DiscoverResult = {
    ID: "NEURON-123",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: [neuronCandidate],
    removeHarmfulSynapse: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(base, discovery);
  const addedNeuron = findCandidate(candidates, "add-neurons");
  const exported = addedNeuron.creature.exportJSON();

  const discoveryNeuron = exported.neurons.find((neuron) =>
    neuron.uuid.startsWith("hidden-discovery-")
  );
  assert(discoveryNeuron, "Expected a discovered neuron to be added.");
  assertEquals(discoveryNeuron?.squash, neuronCandidate.squash);

  const incomingSynapseExists = exported.synapses.some((synapse) =>
    synapse.toUUID === discoveryNeuron?.uuid &&
    synapse.fromUUID === neuronCandidate.fromNeuronUUID
  );
  const outgoingSynapseExists = exported.synapses.some((synapse) =>
    synapse.fromUUID === discoveryNeuron?.uuid &&
    synapse.toUUID === neuronCandidate.toNeuronUUID
  );

  assert(
    incomingSynapseExists && outgoingSynapseExists,
    "Expected discovered neuron to include incoming and outgoing synapses.",
  );
});

Deno.test(
  "buildDiscoveryCandidates synthesises combined candidate across categories",
  () => {
    const base = makeBaselineCreature();
    const helpfulSynapses: CandidateSynapse[] = [{
      fromNeuronUUID: "hidden-2",
      toNeuronUUID: "output-0",
      weight: 0.9,
      expectedImprovementPercentage: 0.2,
      improvedCount: 3,
      totalCount: 5,
    }];
    const removeCandidate: CandidateSynapse = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-1",
      weight: 0.1,
      expectedImprovementPercentage: 0.15,
      improvedCount: 4,
      totalCount: 6,
    };
    const neuronCandidate: CandidateNeuron = {
      fromNeuronUUID: "input-2",
      toNeuronUUID: "hidden-2",
      incomingWeight: 0.33,
      outgoingWeight: -0.22,
      squash: TANH.NAME,
      bias: 0.07,
      expectedImprovementPercentage: 0.18,
      improvedCount: 6,
      totalCount: 8,
    };
    const squashCandidate: CandidateSquash = {
      neuronUUID: "hidden-1",
      previousSquash: IDENTITY.NAME,
      squash: Mish.NAME,
      expectedImprovementPercentage: 0.21,
      improvedError: 0.04,
      currentError: 0.09,
    };

    const discovery: DiscoverResult = {
      ID: "COMBO-ALL",
      addHelpfulSynapses: helpfulSynapses,
      addHelpfulNeurons: [neuronCandidate],
      removeHarmfulSynapse: removeCandidate,
      candidateSquashes: [squashCandidate],
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboAll = findCandidate(candidates, "combo-all");
    const exported = comboAll.creature.exportJSON();

    const harmfulStillExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === removeCandidate.fromNeuronUUID &&
      synapse.toUUID === removeCandidate.toNeuronUUID
    );
    assertEquals(
      harmfulStillExists,
      false,
      "Combined candidate should remove the harmful synapse.",
    );

    const helpfulSynapseExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === helpfulSynapses[0].fromNeuronUUID &&
      synapse.toUUID === helpfulSynapses[0].toNeuronUUID &&
      Math.abs(synapse.weight - helpfulSynapses[0].weight) < 1e-6
    );
    assert(
      helpfulSynapseExists,
      "Combined candidate should include the beneficial synapse.",
    );

    const hidden1 = exported.neurons.find((neuron) =>
      neuron.uuid === "hidden-1"
    );
    assert(hidden1, "Hidden neuron should exist after combination.");
    assertEquals(
      hidden1?.squash,
      squashCandidate.squash,
      "Combined candidate should update the squash function.",
    );

    const incomingDiscoverySynapse = exported.synapses.find((synapse) =>
      synapse.fromUUID === neuronCandidate.fromNeuronUUID &&
      Math.abs(synapse.weight - neuronCandidate.incomingWeight) < 1e-6
    );
    assert(
      incomingDiscoverySynapse,
      "Expected discovery neuron incoming synapse to exist.",
    );
    const discoveredNeuronUUID = incomingDiscoverySynapse!.toUUID;
    const outgoingDiscoverySynapse = exported.synapses.find((synapse) =>
      synapse.fromUUID === discoveredNeuronUUID &&
      synapse.toUUID === neuronCandidate.toNeuronUUID &&
      Math.abs(synapse.weight - neuronCandidate.outgoingWeight) < 1e-6
    );
    assert(
      outgoingDiscoverySynapse,
      "Expected discovery neuron outgoing synapse to exist.",
    );

    const discoveredNeuron = exported.neurons.find((neuron) =>
      neuron.uuid === discoveredNeuronUUID
    );
    assert(
      discoveredNeuron,
      "Combined candidate should include discovered neuron.",
    );
  },
);
