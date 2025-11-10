import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type {
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";

function makeBaseCreature() {
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

function cloneBaseCreature() {
  return Creature.fromJSON(makeBaseCreature().exportJSON());
}

function makeAddCandidate(): CandidateSynapse {
  return {
    fromNeuronUUID: "hidden-2",
    toNeuronUUID: "output-0",
    weight: 0.42,
    expectedImprovementPercentage: 0.25,
    improvedCount: 12,
    totalCount: 20,
  };
}

function makeRemoveCandidate(): CandidateSynapse {
  return {
    fromNeuronUUID: "hidden-1",
    toNeuronUUID: "output-0",
    weight: 0.2,
    expectedImprovementPercentage: 0.3,
    improvedCount: 15,
    totalCount: 20,
  };
}

function makeSquashCandidate(): CandidateSquash {
  return {
    neuronUUID: "hidden-2",
    previousSquash: "IDENTITY",
    squash: "TANH",
    expectedImprovementPercentage: 0.35,
    improvedError: 0.1,
    currentError: 0.2,
  };
}

function assertSynapse(
  creature: Creature,
  fromUUID: string,
  toUUID: string,
) {
  const found = creature.exportJSON().synapses.some((synapse) =>
    synapse.fromUUID === fromUUID && synapse.toUUID === toUUID
  );
  assert(found, `Expected synapse ${fromUUID}->${toUUID} to exist`);
}

Deno.test("buildDiscoveryCandidates returns empty list when there are no suggestions", () => {
  const base = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "ABCD1234",
    addHelpfulSynapses: undefined,
    removeHarmfulSynapse: undefined,
    candidateSquashes: undefined,
  };

  const candidates: DiscoveryCandidate[] = buildDiscoveryCandidates(
    base,
    discovery,
  );
  assertEquals(candidates.length, 0);
  // Original creature should not be altered
  const originalSynapseCount = base.exportJSON().synapses.length;
  assertEquals(originalSynapseCount, 5);
});

Deno.test("buildDiscoveryCandidates includes helpful synapse candidate", () => {
  const base = makeBaseCreature();
  const addCandidate = makeAddCandidate();
  const discovery: DiscoverResult = {
    ID: "HELP1234",
    addHelpfulSynapses: [addCandidate],
    removeHarmfulSynapse: undefined,
    candidateSquashes: undefined,
  };

  const candidates: DiscoveryCandidate[] = buildDiscoveryCandidates(
    base,
    discovery,
  );

  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].change.type, "add-synapses");
  assertSynapse(
    candidates[0].creature,
    addCandidate.fromNeuronUUID,
    addCandidate.toNeuronUUID,
  );
  // Ensure original is untouched
  assertEquals(
    CreatureUtil.makeUUID(base),
    CreatureUtil.makeUUID(cloneBaseCreature()),
  );
});

Deno.test("buildDiscoveryCandidates generates combinations for add and remove", () => {
  const base = makeBaseCreature();
  const addCandidate = makeAddCandidate();
  const removeCandidate = makeRemoveCandidate();
  const discovery: DiscoverResult = {
    ID: "COMBO1",
    addHelpfulSynapses: [addCandidate],
    removeHarmfulSynapse: removeCandidate,
    candidateSquashes: undefined,
  };

  const candidates: DiscoveryCandidate[] = buildDiscoveryCandidates(
    base,
    discovery,
  );
  const types = candidates.map((candidate) => candidate.change.type);
  assertEquals(types.sort(), [
    "add-synapses",
    "combo-add-remove",
    "remove-synapse",
  ]);

  const removeEntry = candidates.find((candidate) =>
    candidate.change.type === "remove-synapse"
  );
  assert(removeEntry);
  const removedSynapses = removeEntry.creature.exportJSON().synapses;
  assertEquals(
    removedSynapses.some((synapse) =>
      synapse.fromUUID === removeCandidate.fromNeuronUUID &&
      synapse.toUUID === removeCandidate.toNeuronUUID
    ),
    false,
  );

  const comboEntry = candidates.find((candidate) =>
    candidate.change.type === "combo-add-remove"
  );
  assert(comboEntry);
  assertSynapse(
    comboEntry.creature,
    addCandidate.fromNeuronUUID,
    addCandidate.toNeuronUUID,
  );
});

Deno.test("buildDiscoveryCandidates combines helpful synapses with squash changes", () => {
  const base = makeBaseCreature();
  const addCandidate = makeAddCandidate();
  const squashCandidate = makeSquashCandidate();
  const discovery: DiscoverResult = {
    ID: "COMBO2",
    addHelpfulSynapses: [addCandidate],
    removeHarmfulSynapse: undefined,
    candidateSquashes: [squashCandidate],
  };

  const candidates: DiscoveryCandidate[] = buildDiscoveryCandidates(
    base,
    discovery,
  );
  const types = candidates.map((candidate) => candidate.change.type);
  assertEquals(types.sort(), [
    "add-synapses",
    "change-squash",
    "combo-add-change",
  ]);

  const changeEntry = candidates.find((candidate) =>
    candidate.change.type === "change-squash"
  );
  assert(changeEntry);
  const changedNeuron = changeEntry.creature.exportJSON().neurons.find((
    neuron,
  ) => neuron.uuid === squashCandidate.neuronUUID);
  assert(changedNeuron);
  assertEquals(changedNeuron.squash, squashCandidate.squash);

  const comboEntry = candidates.find((candidate) =>
    candidate.change.type === "combo-add-change"
  );
  assert(comboEntry);
  const comboNeuron = comboEntry.creature.exportJSON().neurons.find((neuron) =>
    neuron.uuid === squashCandidate.neuronUUID
  );
  assert(comboNeuron);
  assertEquals(comboNeuron.squash, squashCandidate.squash);
  assertSynapse(
    comboEntry.creature,
    addCandidate.fromNeuronUUID,
    addCandidate.toNeuronUUID,
  );
});
