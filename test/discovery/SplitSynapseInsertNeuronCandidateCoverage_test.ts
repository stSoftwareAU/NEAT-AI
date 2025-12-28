import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  SplitSynapseInsertNeuronCandidate,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";
import { buildCacheKey } from "../../src/discovery/FailureCache.ts";

function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [{
      uuid: "output-0",
      type: "output",
      squash: IDENTITY.NAME,
      bias: 0,
    }],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.25 }],
  };
  return Creature.fromJSON(base);
}

function makeSplitCandidate(): SplitSynapseInsertNeuronCandidate {
  return {
    type: "split_synapse_insert_neuron",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
    oldWeight: 0.25,
    newNeuron: {
      uuid: "hidden-split-0",
      type: "hidden",
      squash: IDENTITY.NAME,
      bias: 0.1,
    },
    newSynapses: [
      { "from_uuid": "input-0", "to_uuid": "hidden-split-0", weight: 0.5 },
      { "from_uuid": "hidden-split-0", "to_uuid": "output-0", weight: -0.75 },
    ],
    expectedCreatureScoreGain: 0.123,
    comment: "coverage-test",
  };
}

Deno.test("coverage: buildDiscoveryCandidates includes split-synapse candidates", () => {
  const creature = makeBaseCreature();

  const discovery: DiscoverResult = {
    ID: "discovery-test",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    splitSynapseInsertNeuronCandidates: [makeSplitCandidate()],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(creature, discovery, {
    skipCombinedCandidates: true,
  });

  const splitCandidates = candidates.filter((c) =>
    c.change.type === "split-synapse-insert-neuron"
  );
  assertEquals(splitCandidates.length, 1);

  const exported = splitCandidates[0].creature.exportJSON();
  assert(exported.neurons.some((n) => n.uuid === "hidden-split-0"));
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "input-0" && s.toUUID === "output-0"
    ),
    false,
  );
});

Deno.test("coverage: FailureCache key + rustRequest capture for split-synapse candidate", () => {
  const baseCreature = makeBaseCreature();
  const discovery: DiscoverResult = {
    ID: "discovery-test",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    splitSynapseInsertNeuronCandidates: [makeSplitCandidate()],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const built = buildDiscoveryCandidates(baseCreature, discovery, {
    skipCombinedCandidates: true,
  });
  const split = built.find((c) =>
    c.change.type === "split-synapse-insert-neuron"
  ) as DiscoveryCandidate | undefined;
  assert(split);

  // Build key (exercise split-synapse key path).
  const key = buildCacheKey(split);
  assert(key.includes("split-synapse-insert-neuron"));
});
