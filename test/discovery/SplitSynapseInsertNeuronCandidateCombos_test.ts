import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  SplitSynapseInsertNeuronCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { buildDiscoveryCandidates } from "../../src/discovery/DiscoveryCandidates.ts";

function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  return Creature.fromJSON(base);
}

function makeAddSynapseCandidate(): CandidateSynapse {
  return {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    weight: 0.5,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 10,
    totalCount: 10,
    comment: "combo-test",
  };
}

function makeSplitCandidate(): SplitSynapseInsertNeuronCandidate {
  return {
    type: "split_synapse_insert_neuron",
    fromNeuronUuid: "hidden-0",
    toNeuronUuid: "output-0",
    oldWeight: 0.25,
    newNeuron: {
      uuid: "hidden-split-0",
      type: "hidden",
      squash: IDENTITY.NAME,
      bias: 0,
    },
    newSynapses: [
      { from_uuid: "hidden-0", to_uuid: "hidden-split-0", weight: 0.6 },
      { from_uuid: "hidden-split-0", to_uuid: "output-0", weight: 0.7 },
    ],
    expectedCreatureScoreGain: 0.02,
    comment: "combo-test",
  };
}

function assertSplitApplied(exported: CreatureExport): void {
  assert(exported.neurons.some((n) => n.uuid === "hidden-split-0"));
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "hidden-0" && s.toUUID === "output-0"
    ),
    false,
  );
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "hidden-0" && s.toUUID === "hidden-split-0"
    ),
    true,
  );
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "hidden-split-0" && s.toUUID === "output-0"
    ),
    true,
  );
}

Deno.test("combo-all includes split-synapse-insert-neuron candidates", () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-combo-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    splitSynapseInsertNeuronCandidates: [makeSplitCandidate()],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery);
  const comboAll = candidates.find((c) => c.change.type === "combo-all");
  assert(comboAll);

  const exported = comboAll.creature.exportJSON();
  // Added synapse must exist.
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "input-0" && s.toUUID === "output-0"
    ),
    true,
  );
  // Split must be applied as well.
  assertSplitApplied(exported);
});

Deno.test("combo-best-of-category includes split-synapse-insert-neuron candidates", () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-best-combo-test",
    addHelpfulSynapses: [makeAddSynapseCandidate()],
    addHelpfulNeurons: undefined,
    splitSynapseInsertNeuronCandidates: [makeSplitCandidate()],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(baseCreature, discovery);
  const comboBest = candidates.find((c) =>
    c.change.type === "combo-best-of-category"
  );
  assert(comboBest);

  const exported = comboBest.creature.exportJSON();
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "input-0" && s.toUUID === "output-0"
    ),
    true,
  );
  assertSplitApplied(exported);
});
